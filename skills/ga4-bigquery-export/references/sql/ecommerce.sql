-- Returns: two result sets. (1) purchases deduped on ecommerce.transaction_id
-- with revenue, tax, shipping, and item counts, grouped by event_date.
-- (2) an item-level unnest example for the same window (run this part
-- separately in production - UNNEST(items) multiplies rows).
-- Scan scale: light for the daily summary; the item-level unnest scan
-- is bounded by purchase volume, not total events, so it stays small even
-- over long windows.

WITH purchases AS (
  SELECT
    event_date,
    user_pseudo_id,
    ecommerce.transaction_id AS transaction_id,
    ANY_VALUE(ecommerce.purchase_revenue_in_usd) AS purchase_revenue_in_usd,
    ANY_VALUE(ecommerce.purchase_revenue) AS purchase_revenue,
    ANY_VALUE(ecommerce.tax_value_in_usd) AS tax_value_in_usd,
    ANY_VALUE(ecommerce.shipping_value_in_usd) AS shipping_value_in_usd,
    ANY_VALUE(ecommerce.unique_items) AS unique_items,
    ANY_VALUE(ecommerce.total_item_quantity) AS total_item_quantity
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
    AND event_name = 'purchase'
    AND ecommerce.transaction_id IS NOT NULL
  GROUP BY event_date, user_pseudo_id, transaction_id
)
SELECT
  event_date,
  COUNT(DISTINCT transaction_id) AS purchases,
  SUM(purchase_revenue_in_usd) AS purchase_revenue_usd,
  SUM(tax_value_in_usd) AS tax_usd,
  SUM(shipping_value_in_usd) AS shipping_usd,
  SUM(total_item_quantity) AS items_sold
FROM purchases
GROUP BY event_date
ORDER BY event_date;

-- Item-level unnest example (run separately; UNNEST(items) multiplies rows)
SELECT
  event_date,
  ecommerce.transaction_id AS transaction_id,
  item.item_id,
  item.item_name,
  item.item_category,
  item.quantity,
  item.item_revenue_in_usd
FROM `PROJECT.analytics_PROPERTY_ID.events_*`,
UNNEST(items) AS item
WHERE _TABLE_SUFFIX BETWEEN 'YYYYMMDD' AND 'YYYYMMDD'
  AND event_name = 'purchase'
  AND ecommerce.transaction_id IS NOT NULL
LIMIT 1000;
