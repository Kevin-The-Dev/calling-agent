-- 020 — Default agent configuration
--
-- The identity fields are intentionally left NULL. company-context.md §8 lists
-- them as [UNKNOWN], and the agent must use its fallback response rather than
-- invent a company or consultant name. They are populated from the dashboard
-- (or backend/.env on first boot) before any real call.

insert into agent_settings (
  name,
  is_active,
  system_prompt,
  llm_model,
  temperature,
  max_tokens,
  tts_provider,
  stt_provider
)
select
  'default',
  true,
  -- Placeholder. M2 assembles the real prompt from the knowledge documents;
  -- this exists so the NOT NULL constraint holds and M1 can boot.
  '<!-- assembled at runtime from knowledge_documents in M2 -->',
  'glm-4.5-flash',
  0.6,
  300,
  'browser',
  'browser'
where not exists (select 1 from agent_settings where is_active);
