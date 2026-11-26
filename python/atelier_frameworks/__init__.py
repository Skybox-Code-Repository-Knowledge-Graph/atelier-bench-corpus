"""
Lane-only framework modules: one small, real module per framework the python route, ORM and
schema extractors read, each serving the frozen seed. Flask, the lane's main framework, lives in
atelier_app; this package holds the others:

- fastapi_app.py: FastAPI path operations on an APIRouter (decorator convention), request body
  validated by a Pydantic model, SQLAlchemy session injected with Depends;
- django_site/: a Django site in Django's convention (django_site/settings.py,
  django_site/urls.py with urlpatterns, django_site/views.py), loaded without DJANGO_SETTINGS_MODULE;
- orm.py: a SQLAlchemy 2.x declarative model of the seed's parts;
- schemas.py: the Pydantic models of the parts API.

tests/test_frameworks.py drives each one (request-level through FastAPI's TestClient and Django's
test Client, neither of which opens a network listener).
"""
