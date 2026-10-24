# Privacy

OpenerFit implements no accounts, analytics or cookies. The browser stores only the typed form draft under localStorage key `openerfit.form.v1`, including roster names, fees, notes, venue and booking goals. Run data and capability tokens are not persisted there. Clear this key or the site's browser storage to remove the saved draft. Exported briefs are files you choose to save.

The server keeps runs in memory, with a maximum of 50 entries and a two-hour lifetime from creation. Identity-resolution records also remain in memory (up to 100 records, 30 minutes). Expired entries are removed on subsequent store access; a restart clears memory. Live runs have per-client and global rate limits to protect the shared API key and quota.

Qloo receives artist search names/IDs and relevant venue city/coordinates and taste queries. Its response cache is private and server-side, never published. Cache files use restrictive filesystem permissions; entries older than the configured TTL are not reused. The default TTL is 168 hours. Expiry does not immediately erase disk files. Render's configured `/tmp/qloo-cache` uses ephemeral storage; a local installation's cache can remain on disk until manually removed. Never commit responses or cache files to a public repository.

When `LLM_MODE=openai-compatible` is configured, prompt content is sent to that provider. This may include booking inputs, roster fees/notes and derived evidence, under the provider's terms. Gemini's unpaid tier may use inputs and outputs for product improvement, including human review; consult the [Gemini API terms](https://ai.google.dev/gemini-api/terms). Groq states that inputs and outputs are not used for training or fine-tuning without customer permission/instruction; retention exceptions and usage metadata still apply. See [Groq's services agreement](https://console.groq.com/docs/legal/services-agreement) and [data policy](https://console.groq.com/docs/your-data).

Do not enter confidential information in the public demo. Hosting and API providers may process operational metadata under their own policies. Rate limits reduce shared-quota abuse; they do not make submitted information confidential.
