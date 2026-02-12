'use client';

import { useState, useEffect, useCallback } from 'react';
import { DJApplicationSerialized, DJApplicationStatus } from '@/types/dj-application';
import { ApplicationModal } from './ApplicationModal';

interface DJApplicationsTabProps {
  userId: string;
  onPendingCountChange: (count: number) => void;
}

type FilterStatus = 'all' | 'pending' | 'info-requested' | 'approved' | 'denied';

export function DJApplicationsTab({ userId, onPendingCountChange }: DJApplicationsTabProps) {
  const [applications, setApplications] = useState<DJApplicationSerialized[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [selectedApplication, setSelectedApplication] = useState<DJApplicationSerialized | null>(null);

  const fetchApplications = useCallback(async () => {
    try {
      const response = await fetch('/api/dj-applications');
      if (!response.ok) throw new Error('Failed to fetch applications');
      const data = await response.json();
      setApplications(data.applications || []);

      // Update pending count
      const pendingCount = (data.applications || []).filter(
        (app: DJApplicationSerialized) => app.status === 'pending'
      ).length;
      onPendingCountChange(pendingCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load applications');
    } finally {
      setIsLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const handleStatusChange = async (
    applicationId: string,
    newStatus: DJApplicationStatus,
    additionalData?: { selectedSlot?: { start: number; end: number } }
  ) => {
    try {
      if (newStatus === 'approved' && additionalData?.selectedSlot) {
        // Approve and create slot
        const response = await fetch(`/api/dj-applications/${applicationId}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            selectedSlot: additionalData.selectedSlot,
            createdBy: userId,
          }),
        });
        if (!response.ok) throw new Error('Failed to approve application');
        const data = await response.json();
        return data;
      } else {
        // Just update status
        const response = await fetch(`/api/dj-applications/${applicationId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!response.ok) throw new Error('Failed to update application');
      }
    } catch (err) {
      console.error('Error updating application:', err);
      throw err;
    }
  };

  const handleModalClose = () => {
    setSelectedApplication(null);
    fetchApplications(); // Refresh list
  };

  // Filter applications
  const filteredApplications = applications.filter((app) => {
    if (filterStatus === 'all') return true;
    return app.status === filterStatus;
  });

  // Group by status for display
  const statusGroups: { status: FilterStatus; label: string; count: number }[] = [
    { status: 'all', label: 'All', count: applications.length },
    { status: 'pending', label: 'Pending', count: applications.filter(a => a.status === 'pending').length },
    { status: 'info-requested', label: 'Info Requested', count: applications.filter(a => a.status === 'info-requested').length },
    { status: 'approved', label: 'Approved', count: applications.filter(a => a.status === 'approved').length },
    { status: 'denied', label: 'Denied', count: applications.filter(a => a.status === 'denied').length },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setIsLoading(true);
            fetchApplications();
          }}
          className="mt-4 px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {statusGroups.map((group) => (
          <button
            key={group.status}
            onClick={() => setFilterStatus(group.status)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
              filterStatus === group.status
                ? 'bg-gray-700 text-white'
                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-800'
            }`}
          >
            {group.label}
            {group.count > 0 && (
              <span className={`px-1.5 py-0.5 text-xs rounded ${
                filterStatus === group.status ? 'bg-gray-600' : 'bg-gray-700'
              }`}>
                {group.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Applications list */}
      {filteredApplications.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p>No applications found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredApplications.map((app) => (
            <ApplicationCard
              key={app.id}
              application={app}
              onClick={() => setSelectedApplication(app)}
            />
          ))}
        </div>
      )}

      {/* Application Modal */}
      {selectedApplication && (
        <ApplicationModal
          application={selectedApplication}
          onClose={handleModalClose}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}

// Determine application type
function getApplicationType(app: DJApplicationSerialized): 'profile' | 'livestream' {
  if (app.city || app.genre) return 'profile';
  return 'livestream';
}

// Application Card Component
function ApplicationCard({
  application,
  onClick,
}: {
  application: DJApplicationSerialized;
  onClick: () => void;
}) {
  const statusColors: Record<DJApplicationStatus, string> = {
    pending: 'bg-yellow-900/30 text-yellow-400 border-yellow-800',
    'info-requested': 'bg-blue-900/30 text-blue-400 border-blue-800',
    approved: 'bg-green-900/30 text-green-400 border-green-800',
    denied: 'bg-red-900/30 text-red-400 border-red-800',
  };

  const statusLabels: Record<DJApplicationStatus, string> = {
    pending: 'Pending',
    'info-requested': 'Info Requested',
    approved: 'Approved',
    denied: 'Denied',
  };

  const submittedDate = new Date(application.submittedAt);
  const appType = getApplicationType(application);

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 bg-[#1a1a1a] border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-medium text-white truncate">{application.djName}</h3>
            <span className={`px-2 py-0.5 text-xs rounded border ${statusColors[application.status]}`}>
              {statusLabels[application.status]}
            </span>
            <span className={`px-2 py-0.5 text-xs rounded border ${
              appType === 'profile'
                ? 'bg-purple-900/30 text-purple-400 border-purple-800'
                : 'bg-cyan-900/30 text-cyan-400 border-cyan-800'
            }`}>
              {appType === 'profile' ? 'Profile' : 'Livestream'}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            {appType === 'profile' ? (
              <>
                {application.city && <span>{application.city}</span>}
                {application.genre && <span>{application.genre}</span>}
                {application.onlineRadioShow && <span>Radio: {application.onlineRadioShow}</span>}
              </>
            ) : (
              <>
                {application.showName && <p className="text-sm text-gray-400 truncate">{application.showName}</p>}
                {application.locationType && <span className="capitalize">{application.locationType}</span>}
                {application.venueName && <span>@ {application.venueName}</span>}
                <span>{(application.preferredSlots || []).length} time slot(s)</span>
              </>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-gray-500 shrink-0">
          <p>{submittedDate.toLocaleDateString()}</p>
          <p>{submittedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      </div>
    </button>
  );
}
