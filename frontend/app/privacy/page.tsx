import type { Metadata } from 'next';
import { ProsePage } from '@/components/prose-page';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What the call assistant records, why, and how long it is kept.',
};

/**
 * Written against what the code actually does, not against a template.
 * Every claim here is checkable: the consent gate is in the call console, the
 * retention window is `RECORDING_RETENTION_DAYS`, and the field list is the
 * lead object in `backend/src/types/domain.ts`.
 */
export default function PrivacyPage() {
  return (
    <ProsePage title="Privacy" updated="5 August 2026">
      <section>
        <h2>What happens on a call</h2>
        <p>
          Nothing is recorded until you tick the consent box and press the call button. From that
          point the conversation is transcribed as you speak, and the audio from your microphone is
          recorded so the call can be reviewed later. The assistant tells you it is an AI whenever
          you ask.
        </p>
      </section>

      <section>
        <h2>What we keep</h2>
        <ul>
          <li>Your name, phone number, email address and property address, if you give them.</li>
          <li>What you told us about your electricity bill, utility provider and roof.</li>
          <li>A transcript of the conversation and the audio recording of your side of it.</li>
          <li>The appointment, if one was booked, and who else needs to be there.</li>
        </ul>
        <p>
          Speech recognition and speech synthesis run in your browser. The words you say are sent to
          our server to generate the assistant&apos;s reply, and to the language model provider that
          produces it.
        </p>
      </section>

      <section>
        <h2>How long</h2>
        <p>
          Recordings are deleted after 180 days. Transcripts and lead records are kept for as long
          as we are working on your enquiry, and are deleted on request.
        </p>
      </section>

      <section>
        <h2>Stopping</h2>
        <p>
          Say that you want to be taken off the list at any point in the call. The assistant stops
          immediately, marks the record, and does not try to talk you out of it. You can also end
          the call at any time with the end button, or by closing the tab.
        </p>
      </section>

      <section>
        <h2>Getting your data, or getting rid of it</h2>
        <p>
          Ask for a copy of what we hold, or ask us to delete it, and we will do it. There is no
          form: tell the assistant during a call, or contact us using the details on the
          confirmation we send you.
        </p>
      </section>
    </ProsePage>
  );
}
