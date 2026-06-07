"""Blueprint registration for all /api routes."""
from __future__ import annotations

from flask import Flask

from quiz.routes import bp as quiz_bp

from .cache import bp as cache_bp
from .health import bp as health_bp
from .library import bp as library_bp
from .movie_info import bp as movie_info_bp
from .plex import bp as plex_bp
from .plex_auth import bp as plex_auth_bp
from .series import bootstrap_if_empty as series_bootstrap
from .series import bp as series_bp
from .settings import bp as settings_bp
from .themes import bp as themes_bp


def register_routes(app: Flask) -> None:
    app.register_blueprint(library_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(plex_auth_bp)
    app.register_blueprint(plex_bp)
    app.register_blueprint(movie_info_bp)
    app.register_blueprint(themes_bp)
    app.register_blueprint(series_bp)
    app.register_blueprint(quiz_bp)
    app.register_blueprint(health_bp)
    app.register_blueprint(cache_bp)
    # T1.7 — bootstrap a series scan in the background when no cache exists yet.
    series_bootstrap()
