---
title: Online store products and orders (Shopify / WooCommerce)
tags: [shop, store, ecommerce, shopify, woocommerce, product, products, orders, متجر, منتجات, طلبات]
stacks: [any]
---
1. Read the current catalogue first (commerce.snapshot) to avoid duplicates; match by SKU or external ID.
2. Create products as drafts, check title, price, currency, images and description, then publish.
3. Every write uses an idempotency key / external ID so a retry never creates a second product.
4. Descriptions: benefits first, honest claims, the store's language and tone.
5. Orders: sync, then report totals; never change payment or refund state without the owner's approval.
