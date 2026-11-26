"""Settings of the lane-only Django site: no database, no installed apps, no middleware."""

SECRET_KEY = "atelier-bench-not-a-secret"
DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]
ROOT_URLCONF = "atelier_frameworks.django_site.urls"
INSTALLED_APPS: list[str] = []
MIDDLEWARE: list[str] = []
DATABASES: dict[str, dict[str, str]] = {}
USE_TZ = True
