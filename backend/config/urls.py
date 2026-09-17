from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from assets.admin import secure_admin_site

urlpatterns = [
    path("admin/", secure_admin_site.urls),
    path("api/v1/", include("assets.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]
