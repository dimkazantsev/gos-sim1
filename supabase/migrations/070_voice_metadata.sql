-- Optional voice metadata: waveform is genuine decoded RMS data when supported.
-- Existing text, video and historic voice records remain valid without metadata.
alter table public.chat_messages
 add column if not exists voice_meta jsonb null;
alter table public.chat_messages
 drop constraint if exists chat_messages_voice_meta_shape;
alter table public.chat_messages
 add constraint chat_messages_voice_meta_shape check (
  voice_meta is null or (
   kind = 'audio'
   and jsonb_typeof(voice_meta) = 'object'
   and (not voice_meta ? 'duration' or (
     jsonb_typeof(voice_meta->'duration')='number'
     and (voice_meta->>'duration')::numeric > 0
     and (voice_meta->>'duration')::numeric <= 86400
   ))
   and (not voice_meta ? 'waveform' or (
     jsonb_typeof(voice_meta->'waveform')='array'
     and jsonb_array_length(voice_meta->'waveform')=36
   ))
  )
 );
