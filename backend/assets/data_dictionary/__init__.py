"""Deep module for the settings data dictionary.

The public seam deliberately covers only the two dictionaries that belong to
the settings page: manufacturers and spare-part categories.  Device types
remain part of the asset-configuration module.
"""

from .views import ManufacturerViewSet, SparePartCategoryViewSet

__all__ = ["ManufacturerViewSet", "SparePartCategoryViewSet"]
