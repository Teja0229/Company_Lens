"""Stream Google Maps company results as newline-delimited JSON for server.js."""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from webdriver_manager.chrome import ChromeDriverManager


TYPE_QUERIES = {
    "IT & Software": "IT software companies",
    "Pharmaceutical & Healthcare": "pharmaceutical healthcare companies",
    "Manufacturing": "manufacturing companies",
    "Financial Services": "financial services companies",
    "FinTech": "fintech companies",
    "Consulting": "consulting companies",
    "Corporate / Conglomerates": "corporate conglomerate companies",
    "Financial Consulting": "financial consulting companies",
    "E-commerce & Retail": "e-commerce retail companies",
    "Telecommunications": "telecommunications companies",
    "Education & EdTech": "education edtech companies",
    "Real Estate & Construction": "real estate construction companies",
    "Logistics & Transportation": "logistics transportation companies",
    "Energy & Utilities": "energy utilities companies",
    "Other": "companies",
}


def value_or_na(driver, selector, attribute=None, prefix=""):
    try:
        element = driver.find_element(By.XPATH, selector)
        value = element.get_attribute(attribute) if attribute else element.text
        return (value or "N/A").replace(prefix, "").strip()
    except Exception:
        return "N/A"


def clean_linkedin_url(url):
    if not url:
        return "N/A"
    parsed = urllib.parse.urlparse(url)
    if "linkedin.com" not in parsed.netloc.lower():
        return "N/A"
    path = parsed.path.rstrip("/")
    if not (path.startswith("/company/") or path.startswith("/in/")):
        return "N/A"
    return urllib.parse.urlunparse(("https", "www.linkedin.com", path, "", "", ""))


def same_website(url, domain):
    parsed = urllib.parse.urlparse(url)
    return parsed.scheme in ("http", "https") and parsed.netloc.lower().removeprefix("www.") == domain


def useful_company_pages(driver, home_url):
    home_domain = urllib.parse.urlparse(home_url).netloc.lower().removeprefix("www.")
    pages = [home_url]
    for anchor in driver.find_elements(By.CSS_SELECTOR, "a[href]"):
        href = anchor.get_attribute("href") or ""
        label = f"{anchor.text} {href}".lower()
        if same_website(href, home_domain) and any(
            word in label for word in ("contact", "about", "company", "team", "people", "leadership")
        ):
            clean_url = urllib.parse.urldefrag(href)[0]
            if clean_url not in pages:
                pages.append(clean_url)
        if len(pages) == 6:
            break
    return pages


def public_members(driver):
    """Find up to five named public LinkedIn profiles on an official company page."""
    members, seen_profiles = [], set()
    for link in driver.find_elements(By.CSS_SELECTOR, 'a[href*="linkedin.com/in/"]'):
        profile_url = clean_linkedin_url(link.get_attribute("href"))
        if profile_url == "N/A" or profile_url in seen_profiles:
            continue
        name = (link.text or link.get_attribute("aria-label") or "").strip()
        name = re.sub(r"\s+", " ", name)
        if not name or name.lower() in {"linkedin", "profile", "view profile"}:
            continue
        role = ""
        try:
            role = re.sub(r"\s+", " ", link.find_element(By.XPATH, "..").text).strip()
            role = role.replace(name, "", 1).strip(" -|\n")
        except Exception:
            pass
        members.append({"name": name[:160], "role": role[:160] or "N/A", "linkedin_url": profile_url})
        seen_profiles.add(profile_url)
        if len(members) == 5:
            break
    return members


def website_details(driver, url):
    details = {"email": "N/A", "linkedin_url": "N/A", "employees": []}
    if not url or url == "N/A":
        return details
    try:
        driver.get(url)
        time.sleep(2)
        for page in useful_company_pages(driver, driver.current_url):
            driver.get(page)
            time.sleep(1)
            if details["email"] == "N/A":
                links = driver.find_elements(By.CSS_SELECTOR, 'a[href^="mailto:"]')
                if links:
                    details["email"] = links[0].get_attribute("href").replace("mailto:", "").split("?")[0]
                else:
                    match = re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", driver.page_source)
                    if match:
                        details["email"] = match.group(0)
            if details["linkedin_url"] == "N/A":
                for link in driver.find_elements(By.CSS_SELECTOR, 'a[href*="linkedin.com"]'):
                    linkedin_url = clean_linkedin_url(link.get_attribute("href"))
                    if linkedin_url != "N/A" and "/company/" in linkedin_url:
                        details["linkedin_url"] = linkedin_url
                        break
            for member in public_members(driver):
                if all(existing["linkedin_url"] != member["linkedin_url"] for existing in details["employees"]):
                    details["employees"].append(member)
                if len(details["employees"]) == 5:
                    break
    except Exception:
        pass
    return details


def extract_rating(driver):
    """Extract rating score (e.g. '4.5') using multiple Google Maps selector strategies."""
    selectors = [
        '//div[contains(@class,"F7nice")]//span[@aria-hidden="true"]',
        '//span[contains(@aria-label, "star") or contains(@aria-label, "stars")]',
        '//div[contains(@class,"fontDisplayLarge")]',
        '//span[contains(@class, "MW4etd")]',
        '//div[@role="main"]//span[contains(@aria-label, "star")]',
    ]
    for xpath in selectors:
        try:
            for el in driver.find_elements(By.XPATH, xpath):
                aria = el.get_attribute("aria-label") or ""
                match = re.search(r"(\d+(?:\.\d+)?)", aria)
                if match:
                    val = float(match.group(1))
                    if 0.0 <= val <= 5.0:
                        return f"{val:.1f}"
                text = (el.text or "").strip()
                match = re.search(r"^(\d(?:\.\d)?)$", text)
                if match:
                    val = float(match.group(1))
                    if 0.0 <= val <= 5.0:
                        return f"{val:.1f}"
        except Exception:
            continue
    return "N/A"


def company_details(driver, wait, url):
    driver.get(url)
    time.sleep(2)
    try:
        name = wait.until(EC.presence_of_element_located((By.XPATH, '//h1[contains(@class,"DUwDvf")]'))).text
    except Exception:
        name = "N/A"
    website = value_or_na(driver, '//a[@data-item-id="authority"]', "href")
    details = {
        "company_name": name,
        "rating": extract_rating(driver),
        "address": value_or_na(driver, '//button[@data-item-id="address"]', "aria-label", "Address: "),
        "phone": value_or_na(driver, '//button[contains(@data-item-id,"phone")]', "aria-label", "Phone: "),
        "website": website,
        "google_maps_link": url,
    }
    details.update(website_details(driver, website))
    return details


def extract_place_id(url):
    if not url:
        return ""
    match = re.search(r"1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)", url)
    if match:
        return match.group(1).lower()
    match2 = re.search(r"(ChIJ[a-zA-Z0-9_-]+)", url)
    if match2:
        return match2.group(1)
    return ""


def normalize_company_name(name):
    clean = re.sub(r"\b(pvt|ltd|llc|inc|private|limited|corp|corporation|co)\b", "", (name or "").lower())
    return re.sub(r"[^a-z0-9]", "", clean)


def result_items(driver, wait):
    # 1. Dismiss consent dialog if present
    try:
        consent_buttons = driver.find_elements(
            By.XPATH,
            '//button[contains(., "Accept all") or contains(., "Agree") or contains(., "I agree") or contains(., "Accept")]',
        )
        if consent_buttons:
            consent_buttons[0].click()
            time.sleep(1)
    except Exception:
        pass

    # 2. Check if Google Maps redirected directly to a single company place
    if "/maps/place/" in driver.current_url:
        try:
            h1 = driver.find_elements(By.XPATH, '//h1[contains(@class,"DUwDvf")]')
            name = h1[0].text if h1 else ""
            return [{"url": driver.current_url, "name": name}]
        except Exception:
            return [{"url": driver.current_url, "name": ""}]

    # 3. Wait for search results container, direct links, or redirect
    panel = None
    feed_selectors = [
        '//div[@role="feed"]',
        '//div[contains(@aria-label, "Results for") or contains(@aria-label, "Search Results")]',
        '//div[contains(@class, "m6QErb") and contains(@class, "DxyBCb")]',
        '//div[@role="main"]',
    ]

    end_time = time.time() + 15
    while time.time() < end_time:
        # Check if redirected to a single place during search loading
        if "/maps/place/" in driver.current_url:
            h1 = driver.find_elements(By.XPATH, '//h1[contains(@class,"DUwDvf")]')
            name = h1[0].text if h1 else ""
            return [{"url": driver.current_url, "name": name}]

        # Check for feed container
        for xpath in feed_selectors:
            elements = driver.find_elements(By.XPATH, xpath)
            if elements:
                panel = elements[0]
                break
        if panel:
            break

        # Check if result links are already present even without a matching feed panel
        if driver.find_elements(By.CSS_SELECTOR, "a.hfpxzc"):
            break

        # Check if "No results found" is displayed
        no_results = driver.find_elements(
            By.XPATH,
            '//*[contains(text(), "No results found") or contains(text(), "Google Maps can\'t find") or contains(text(), "make sure that your search is spelled correctly")]',
        )
        if no_results:
            print("Google Maps found no matching results for this search.", file=sys.stderr)
            return []

        time.sleep(0.8)

    # 4. Scroll panel if found to load more results
    if panel:
        try:
            previous_height, stable_scrolls = -1, 0
            while stable_scrolls < 2:
                driver.execute_script("arguments[0].scrollTop = arguments[0].scrollHeight;", panel)
                time.sleep(1.5)
                height = driver.execute_script("return arguments[0].scrollHeight;", panel)
                stable_scrolls = stable_scrolls + 1 if height == previous_height else 0
                previous_height = height
        except Exception:
            pass

    # 5. Extract all result links
    items = []
    seen = set()
    for item in driver.find_elements(By.CSS_SELECTOR, "a.hfpxzc"):
        href = item.get_attribute("href") or ""
        name = (item.get_attribute("aria-label") or "").strip()
        if href and href not in seen:
            seen.add(href)
            items.append({"url": href, "name": name})

    # If still no items and current URL has place, use current URL as single result
    if not items and "/maps/place/" in driver.current_url:
        h1 = driver.find_elements(By.XPATH, '//h1[contains(@class,"DUwDvf")]')
        name = h1[0].text if h1 else ""
        items.append({"url": driver.current_url, "name": name})

    return items



def load_existing_identifiers(existing_file):
    existing_cids = set()
    existing_names = set()
    existing_urls = set()
    if not existing_file or not os.path.exists(existing_file):
        return existing_cids, existing_names, existing_urls
    try:
        with open(existing_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            for entry in data:
                if isinstance(entry, dict):
                    link = entry.get("google_maps_link") or entry.get("link") or ""
                    name = entry.get("company_name") or entry.get("name") or ""
                else:
                    link = str(entry)
                    name = ""
                if link:
                    existing_urls.add(link.split("?")[0].rstrip("/").lower())
                    cid = extract_place_id(link)
                    if cid:
                        existing_cids.add(cid)
                norm_name = normalize_company_name(name)
                if norm_name:
                    existing_names.add(norm_name)
    except Exception as e:
        print(f"Warning: Could not read existing file: {e}", file=sys.stderr)
    return existing_cids, existing_names, existing_urls


def scrape_companies(country="", city="", rating="", company_name="", headless=True, company_type="", existing_file=None):
    min_rating = None
    if rating and str(rating).strip().lower() not in {"all", "any"}:
        match = re.search(r"(\d+(?:\.\d+)?)", str(rating))
        if match:
            min_rating = float(match.group(1))

    existing_cids, existing_names, existing_urls = load_existing_identifiers(existing_file)

    keyword = company_name or (TYPE_QUERIES.get(company_type) if company_type else None)
    if not keyword:
        keyword = "top rated companies" if (min_rating and min_rating >= 4.0) else "companies"

    location_parts = [part for part in (city, country) if part]
    if location_parts:
        search_query_str = f"{keyword} in {', '.join(location_parts)}"
    else:
        search_query_str = keyword

    query = urllib.parse.quote_plus(search_query_str)
    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    wait = WebDriverWait(driver, 15)
    try:
        driver.get(f"https://www.google.com/maps/search/{query}")
        for item in result_items(driver, wait):
            url = item["url"]
            name_hint = item["name"]

            # Fast check before opening the page
            cid = extract_place_id(url)
            clean_url = url.split("?")[0].rstrip("/").lower()
            norm_hint = normalize_company_name(name_hint)

            is_duplicate = False
            if cid and cid in existing_cids:
                is_duplicate = True
            elif clean_url in existing_urls:
                is_duplicate = True
            elif norm_hint and len(norm_hint) >= 5 and norm_hint in existing_names:
                is_duplicate = True

            if is_duplicate:
                yield {
                    "status": "skipped",
                    "company_name": name_hint or "Existing Company",
                    "google_maps_link": url,
                    "reason": "Already exists in database",
                }
                continue

            try:
                details = company_details(driver, wait, url)
                # Check again with full parsed name if name_hint was empty
                actual_name = details.get("company_name", "")
                norm_actual = normalize_company_name(actual_name)
                if norm_actual and len(norm_actual) >= 5 and norm_actual in existing_names:
                    yield {
                        "status": "skipped",
                        "company_name": actual_name,
                        "google_maps_link": url,
                        "reason": "Already exists in database",
                    }
                    continue

                if min_rating is not None and details.get("rating") not in ("N/A", None, ""):
                    try:
                        if float(details["rating"]) < min_rating:
                            continue
                    except (ValueError, TypeError):
                        pass
                yield details
            except Exception as error:
                print(f"Skipped one result: {error}", file=sys.stderr)
    finally:
        driver.quit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--country", default="")
    parser.add_argument("--city", default="")
    parser.add_argument("--rating", default="")
    parser.add_argument("--company-type", default="")
    parser.add_argument("--company-name", default="")
    parser.add_argument("--existing-file", default="")
    args = parser.parse_args()
    headless = os.getenv("SCRAPER_HEADLESS", "true").lower() not in {"0", "false", "no"}
    rating = args.rating
    for company in scrape_companies(
        args.country,
        args.city,
        rating=rating,
        company_name=args.company_name,
        headless=headless,
        company_type=args.company_type,
        existing_file=args.existing_file,
    ):
        print(json.dumps(company), flush=True)


if __name__ == "__main__":
    main()
