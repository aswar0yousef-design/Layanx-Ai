# LayanX Growth Engine
LayanX Growth Engine is a local-first measurement and experimentation layer for running an organic commerce growth loop. It does not promise viral reach or guaranteed revenue.

## Loop
1. Diagnose the weakest measurable funnel stage.
2. Create one bounded experiment.
3. Publish through the existing business/social pipeline after normal approval and capability gates.
4. Record platform/content funnel metrics.
5. Re-diagnose and create the next experiment.

## Metrics
Attention: impressions, views, completion. Intent: shares, saves. Visit: product visits. Conversion: add-to-cart, checkout, purchase, revenue. Retention: repeat purchases.

## Safety
The engine does not bypass platform ranking, fabricate engagement, spam users, or launch paid campaigns. Publishing remains behind the existing content approval/capability path. Paid advertising remains a separate, explicit subsystem.

## Local storage
Set LAYANX_GROWTH_STORAGE_PATH to persist growth state; default is .layanx/growth.json.

## API
- GET /v1/growth
- GET /v1/growth/dashboard
- POST /v1/growth/experiment
- POST /v1/growth/plan-cycle
- POST /v1/growth/metric
- POST /v1/growth/action/complete
