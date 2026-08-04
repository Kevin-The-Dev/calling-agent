import { CallWidget } from '@/components/call-widget';

export const metadata = {
  title: 'Solar Consultation — Talk to us',
};

export default function CallPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <CallWidget />
    </main>
  );
}
