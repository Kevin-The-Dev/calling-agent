import type { Metadata } from 'next';
import { ProsePage } from '@/components/prose-page';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'What the call is and is not, and what happens after you book.',
};

export default function TermsPage() {
  return (
    <ProsePage title="Terms" updated="5 August 2026">
      <section>
        <h2>What this is</h2>
        <p>
          You are talking to an automated assistant whose only job is to work out whether your home
          is worth an engineer&apos;s visit, and to book that visit if it is. It is not a
          salesperson and it cannot sell you anything.
        </p>
      </section>

      <section>
        <h2>What it cannot tell you</h2>
        <p>
          The assistant will not tell you that you are approved, quote you a price, or put a figure
          on what you would save. Nobody can do that before an engineer has looked at your roof and
          your bill. Anything you are told on the call about eligibility or savings is an
          expectation, not an offer.
        </p>
      </section>

      <section>
        <h2>Booking a visit</h2>
        <p>
          An appointment is a time an engineer will come out. It commits you to nothing else. There
          is no charge for the visit, no obligation to buy afterwards, and you can cancel by
          replying to the confirmation we text you.
        </p>
      </section>

      <section>
        <h2>Accuracy</h2>
        <p>
          The assistant transcribes speech, and speech recognition makes mistakes. Read back the
          phone number and email on the confirmation and tell us if either is wrong. Where it is not
          sure of an answer it will say so rather than guess.
        </p>
      </section>

      <section>
        <h2>Fair use</h2>
        <p>
          The call service is rate limited. Repeated automated calls, attempts to extract the
          assistant&apos;s instructions, or use of the service for anything other than a genuine
          enquiry will be blocked.
        </p>
      </section>
    </ProsePage>
  );
}
