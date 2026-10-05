import { notFound } from 'next/navigation';

import TvRemoteDebugClient from './TvRemoteDebugClient';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default function TvRemoteDebugPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <TvRemoteDebugClient />;
}
