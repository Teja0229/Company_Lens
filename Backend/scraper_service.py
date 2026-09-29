"""Local HTTP bridge for the Google Maps scraper.

This keeps Python running as its own process so the Node API does not need to
spawn a child process on Windows environments that block child-process launch.
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from google_maps_scraper import scrape_companies


class ScraperHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/scrape":
            self.send_error(404)
            return
        try:
            size = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(size) or b"{}")
            country = str(payload.get("country", "")).strip()
            city = str(payload.get("city", "")).strip()
            rating = str(payload.get("rating", payload.get("minRating", ""))).strip()
            company_name = str(payload.get("companyName", "")).strip()
            company_type = str(payload.get("companyType", "")).strip()
            if not company_name and not (country and city):
                raise ValueError("Company name or country and city are required.")
            companies = list(scrape_companies(country, city, rating=rating, company_name=company_name, company_type=company_type))
            body = json.dumps({"data": companies}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as error:
            body = json.dumps({"error": str(error)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, *_):
        pass


if __name__ == "__main__":
    port = int(os.getenv("SCRAPER_SERVICE_PORT", "5001"))
    ThreadingHTTPServer(("127.0.0.1", port), ScraperHandler).serve_forever()
