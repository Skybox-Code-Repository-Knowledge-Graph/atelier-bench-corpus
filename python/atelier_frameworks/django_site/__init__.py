"""
A Django site in Django's own convention: settings.py, urls.py whose `urlpatterns` maps each path
pattern to a view, and views.py. `configure()` loads the upper-case names of settings.py into
django.conf.settings once, so nothing depends on DJANGO_SETTINGS_MODULE.
"""

from __future__ import annotations

import django
from django.conf import settings as django_settings

from . import settings


def configure() -> None:
    if not django_settings.configured:
        django_settings.configure(**{name: getattr(settings, name) for name in dir(settings) if name.isupper()})
        django.setup()
