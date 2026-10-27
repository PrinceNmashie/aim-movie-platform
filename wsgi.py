import os

from werkzeug.middleware.proxy_fix import ProxyFix

from app import app

if os.environ.get("RENDER") == "true":
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_proto=1,
    )