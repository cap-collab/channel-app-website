import { Metadata } from 'next';
import { AdminDashboard } from './AdminDashboard';

export const metadata: Metadata = {
  title: 'Broadcast Admin - Channel',
  description: 'Manage your radio station broadcasts',
};

export default function AdminPage() {
  return <AdminDashboard />;
}
