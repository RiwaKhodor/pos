export function customsFromContainer(
  itemCost: number,
  container: { cost: number; totalDuty: number } | null | undefined
) {
  const cost = Number.isFinite(itemCost) ? itemCost : 0;
  if (!container || !(container.cost > 0)) return 0;
  const duty = Number.isFinite(container.totalDuty)
    ? Math.max(0, container.totalDuty)
    : 0;
  return Number(((cost * duty) / container.cost).toFixed(4));
}
