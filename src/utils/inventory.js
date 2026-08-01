// INV-05: single definition of "low stock" shared between InventoryScreen (filter toggle)
// and DashboardScreen (badge count) so the two never drift out of sync.
export function isLowStock(item) {
  return item.quantityOnHand <= item.lowStockThreshold;
}
