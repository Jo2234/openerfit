# Deploy on Render Free

The repository includes a Dockerfile and `render.yaml` Blueprint for a free Docker web service. Use a full dependency install: `tsx` is required at runtime. The image builds the frontend and serves it with the API.

1. Create a Render account and connect the public source repository. A payment method is not required for a Free web service.
2. In the dashboard, choose **New → Blueprint**, select the repository and branch, and use its `render.yaml`. Confirm the web service uses the Free plan.
3. Supply `QLOO_API_KEY` as a dashboard secret. The Blueprint enables `QLOO_MODE=live`; use a key issued for the hackathon host.
4. For a real model, set `LLM_MODE=openai-compatible`, secret `LLM_API_KEY`, and `LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS`, `LLM_LLAMACPP`, `LLM_SUPPORTS_SEED`, `LLM_REASONING_EFFORT`, `LLM_PLANNER_MAX_TOKENS`, `LLM_WRITER_MAX_TOKENS`, `LLM_BASELINE_MAX_TOKENS` in the dashboard. Use the provider configurations in [README](../README.md). The Blueprint defaults to `LLM_MODE=none`, which uses labelled scripted/template operation.
5. Deploy and visit `/api/health` on the service URL. Confirm the expected modes, then test identity confirmation, brief generation and export. A health response alone does not verify live Qloo or real inference.

The image binds `0.0.0.0:10000`; Render supplies the service environment. The health path is `/api/health`. Keep keys out of Git and browser code. The response cache is private ephemeral storage at `/tmp/qloo-cache`; in-memory runs and cache files may disappear on restart/redeploy. Review [privacy](../PRIVACY.md) and each provider's terms before using the demo.

Render Free services spin down after 15 minutes without inbound traffic; waking can take approximately one minute. A workspace receives 750 free instance hours each month, shared by its Free web services. Without a payment method, exceeding applicable free usage limits suspends services rather than billing overages. Check current limits and suspension behavior in [Render's Free documentation](https://render.com/docs/free). Sleeping services and shared API quotas constrain availability; monitor the deployed demo throughout any judging period.
