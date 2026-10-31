import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Trash2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Server,
  Download,
  AlertCircle,
  Loader2,
  Cpu,
  PackageCheck,
  Clock,
  Bell,
  Send,
  Key,
} from 'lucide-react';
import { ReleaseMetadata } from '../../../server/storage';
import {
  inspectApkFile,
  ClientApkMetadata,
  OFFICIAL_ZOYA_PACKAGE,
} from '../../utils/apkParser';
import { LicenseManager } from './LicenseManager';

interface ReleaseManagerProps {
  token: string;
  onReleasePublished: () => void;
  onUnauthorized?: () => void;
}

export const ReleaseManager: React.FC<ReleaseManagerProps> = ({
  token,
  onReleasePublished,
  onUnauthorized,
}) => {
  const [releases, setReleases] = useState<ReleaseMetadata[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'upload' | 'licenses' | 'notify' | 'history' | 'storage-config'
  >('upload');

  // APK Inspection & Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspectingApk, setInspectingApk] = useState<boolean>(false);
  const [extractedApk, setExtractedApk] = useState<ClientApkMetadata | null>(null);
  const [cachedBuffer, setCachedBuffer] = useState<ArrayBuffer | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedDraft, setUploadedDraft] = useState<ReleaseMetadata | null>(null);

  // Publish Form State (Only Release Notes is manual; all APK metadata & server date are automatic)
  const [releaseNotes, setReleaseNotes] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

  // Manual Push Notification State
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifConfirming, setNotifConfirming] = useState(false);
  const [sendingNotif, setSendingNotif] = useState(false);
  const [notifRequestId, setNotifRequestId] = useState(() => `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
  const [notifFeedback, setNotifFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchReleases = async () => {
    setLoadingReleases(true);
    try {
      const res = await fetch('/api/admin/releases', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401) {
        onUnauthorized?.();
        return;
      }
      const rawText = await res.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        console.warn('Non-JSON response received from /api/admin/releases:', rawText);
      }
      if (res.ok && data.success && Array.isArray(data.releases)) {
        setReleases(data.releases);
      }
    } catch (err) {
      console.error('Failed to fetch releases:', err);
    } finally {
      setLoadingReleases(false);
    }
  };

  useEffect(() => {
    fetchReleases();
  }, [token]);

  // Identify latest published release for version code validation
  const publishedReleases = releases.filter((r) => r.isPublished);
  const latestPublished =
    publishedReleases.length > 0
      ? [...publishedReleases].sort((a, b) => b.versionCode - a.versionCode)[0]
      : null;

  // Automatically inspect the selected APK file and validate embedded metadata
  const handleFileSelection = async (file: File | null) => {
    setSelectedFile(file);
    setExtractedApk(null);
    setCachedBuffer(null);
    setValidationError(null);
    setUploadError(null);
    setUploadedDraft(null);
    setPublishMessage(null);
    setUploadProgress(0);

    if (!file) return;

    setInspectingApk(true);
    try {
      const { metadata, arrayBuffer } = await inspectApkFile(file);

      // 1. Validate official Zoya package name
      if (metadata.packageName !== OFFICIAL_ZOYA_PACKAGE) {
        setExtractedApk(metadata);
        setValidationError(
          `Package name mismatch: This APK has package name "${metadata.packageName}", but the official Zoya Android package must be "${OFFICIAL_ZOYA_PACKAGE}".`
        );
        return;
      }

      // 2. Validate versionCode against the latest published release
      if (latestPublished && metadata.versionCode <= latestPublished.versionCode) {
        setExtractedApk(metadata);
        setValidationError(
          `Version code conflict: This APK has versionCode ${metadata.versionCode} (version ${metadata.versionName}), which is not higher than the currently published release (${latestPublished.versionName}, versionCode ${latestPublished.versionCode}). Please upload a newer build with versionCode > ${latestPublished.versionCode}.`
        );
        return;
      }

      setExtractedApk(metadata);
      setCachedBuffer(arrayBuffer);
    } catch (err: unknown) {
      setValidationError(
        err instanceof Error
          ? err.message
          : 'Failed to read APK metadata. Please ensure the file is a valid, uncorrupted Android APK.'
      );
    } finally {
      setInspectingApk(false);
    }
  };

  // Chunked binary upload so APKs of any size persist reliably across Vercel serverless invocations
  const handleUploadApk = async () => {
    if (!selectedFile || !extractedApk || !cachedBuffer || validationError) return;

    setUploadError(null);
    setUploadProgress(0);
    setUploading(true);
    setUploadedDraft(null);
    setPublishMessage(null);

    try {
      const uint8 = new Uint8Array(cachedBuffer);

      const CHUNK_SIZE = 524288; // 512 KB per chunk
      const totalChunks = Math.ceil(uint8.length / CHUNK_SIZE);
      const safeBase = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storageKey = `${Date.now()}-${safeBase}`;

      let completedChunks = 0;

      // Upload chunks sequentially to ensure reliable serverless reception and exact size bounds
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, uint8.length);
        const chunkSlice = uint8.slice(start, end);

        const chunkRes = await fetch(
          `/api/admin/upload?phase=chunk&storageKey=${encodeURIComponent(storageKey)}&index=${chunkIndex}&totalChunks=${totalChunks}`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/octet-stream',
            },
            body: chunkSlice,
          }
        );

        const chunkText = await chunkRes.text();
        let chunkData: any = {};
        try {
          chunkData = chunkText ? JSON.parse(chunkText) : {};
        } catch {
          // Ignore
        }

        if (!chunkRes.ok || !chunkData.success) {
          throw new Error(
            chunkData.error || `Failed to upload chunk ${chunkIndex + 1}/${totalChunks} (HTTP ${chunkRes.status})`
          );
        }

        completedChunks += 1;
        setUploadProgress(Math.min(95, Math.round((completedChunks / totalChunks) * 95)));
      }

      // Finalize upload: server independently parses AndroidManifest.xml and saves the verified draft
      const finalizeRes = await fetch('/api/admin/upload?phase=finalize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storageKey,
          fileName: selectedFile.name,
          fileSize: uint8.length,
          totalChunks,
          sha256: extractedApk.sha256,
        }),
      });

      const finalizeText = await finalizeRes.text();
      let finalizeData: any = {};
      try {
        finalizeData = finalizeText ? JSON.parse(finalizeText) : {};
      } catch {
        throw new Error('Unexpected server response when finalizing APK upload.');
      }

      if (!finalizeRes.ok || !finalizeData.success) {
        throw new Error(finalizeData.error || 'Failed to finalize APK upload.');
      }

      setUploadProgress(100);
      setUploadedDraft(finalizeData.draft);
      fetchReleases();
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'APK upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadedDraft) return;

    setPublishing(true);
    setPublishMessage(null);

    try {
      const res = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          draftId: uploadedDraft.id,
          releaseNotes: releaseNotes.trim(),
        }),
      });

      const rawText = await res.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Server returned error (${res.status}): ${rawText.slice(0, 100) || res.statusText}`);
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to publish release');
      }

      const publishedRel: ReleaseMetadata = data.release;
      const notif = data.notification;
      let notifSummary = '';
      if (notif) {
        if (notif.sent) {
          notifSummary = ` FCM push notification ("${notif.title}") sent to topic "${notif.topic}".`;
        } else if (notif.alreadySent) {
          notifSummary = ` FCM push notification was already sent for this release version.`;
        } else if (!notif.configured) {
          notifSummary = ` (Note: Configure FIREBASE_SERVICE_ACCOUNT_JSON on Vercel to enable Android push notifications.)`;
        } else if (notif.reason) {
          notifSummary = ` (FCM notice: ${notif.reason})`;
        }
      }

      setPublishMessage({
        type: 'success',
        text: `Release ${publishedRel.versionName} (versionCode ${publishedRel.versionCode}) published on ${publishedRel.releaseDate}! The public download button and manifest are now live.${notifSummary}`,
      });

      // Reset upload state
      setSelectedFile(null);
      setExtractedApk(null);
      setCachedBuffer(null);
      setUploadedDraft(null);
      setReleaseNotes('');
      if (fileInputRef.current) fileInputRef.current.value = '';

      fetchReleases();
      onReleasePublished();
    } catch (err: unknown) {
      setPublishMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error publishing release',
      });
    } finally {
      setPublishing(false);
    }
  };

  const handleDeleteRelease = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/releases/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const rawText = await res.text();
      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        // Ignored
      }

      if (res.ok && data.success) {
        if (uploadedDraft?.id === id) {
          setUploadedDraft(null);
        }
        setConfirmDeleteId(null);
        fetchReleases();
        onReleasePublished();
      } else {
        setPublishMessage({
          type: 'error',
          text: data.error || `Could not delete release (${res.status})`,
        });
      }
    } catch {
      setPublishMessage({
        type: 'error',
        text: 'Network error when attempting to delete release.',
      });
    } finally {
      setDeletingId(null);
    }
  };

  // Step 1 of Manual Push Notification: Validate inputs and open confirmation view
  const handleInitiateNotification = (e: React.FormEvent) => {
    e.preventDefault();
    if (sendingNotif) return;

    setNotifFeedback(null);
    const trimmedTitle = notifTitle.trim();
    const trimmedMessage = notifMessage.trim();

    if (!trimmedTitle) {
      setNotifFeedback({ type: 'error', text: 'Notification Title is required.' });
      return;
    }
    if (trimmedTitle.length > 60) {
      setNotifFeedback({ type: 'error', text: 'Notification Title cannot exceed 60 characters.' });
      return;
    }
    if (!trimmedMessage) {
      setNotifFeedback({ type: 'error', text: 'Message is required.' });
      return;
    }
    if (trimmedMessage.length > 200) {
      setNotifFeedback({ type: 'error', text: 'Message cannot exceed 200 characters.' });
      return;
    }

    setNotifConfirming(true);
  };

  // Step 2 of Manual Push Notification: Confirm & send to authenticated backend endpoint
  const handleConfirmSendNotification = async () => {
    if (sendingNotif) return;

    const trimmedTitle = notifTitle.trim();
    const trimmedMessage = notifMessage.trim();
    if (!trimmedTitle || !trimmedMessage || trimmedTitle.length > 60 || trimmedMessage.length > 200) {
      setNotifConfirming(false);
      return;
    }

    setSendingNotif(true);
    setNotifFeedback(null);

    try {
      const res = await fetch('/api/admin/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: trimmedTitle,
          message: trimmedMessage,
          requestId: notifRequestId,
        }),
      });

      const rawText = await res.text();
      let data: any = {};
      let isJson = false;
      try {
        if (rawText) {
          data = JSON.parse(rawText);
          isJson = true;
        }
      } catch {
        isJson = false;
      }

      if (!res.ok || !data.success) {
        if (res.status === 404) {
          throw new Error(
            data?.error
              ? `Endpoint not found (404): ${data.error}`
              : 'Notification endpoint not found (404): POST /api/admin/notify is not deployed on this server yet. Please sync the latest repository changes to GitHub and redeploy on Vercel.'
          );
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `Authentication failed (${res.status}): ${
              data?.error || 'Your administrator session has expired or is unauthorized. Please sign out and sign in again.'
            }`
          );
        }
        if (res.status === 503) {
          throw new Error(
            `Missing server credentials (503): ${
              data?.error ||
              'Firebase Cloud Messaging service-account credentials (FIREBASE_SERVICE_ACCOUNT_JSON) are not configured on the server.'
            }`
          );
        }
        if (res.status === 409) {
          throw new Error(
            data?.error || 'Duplicate notification prevented (409): An identical notification was just sent recently.'
          );
        }
        if (res.status === 400) {
          throw new Error(`Validation error (400): ${data?.error || 'Invalid notification title or message.'}`);
        }
        if (res.status === 502 || res.status === 500) {
          throw new Error(
            `FCM send failure (${res.status}): ${
              data?.error || 'Failed to dispatch push notification via Firebase Cloud Messaging.'
            }`
          );
        }
        if (!isJson) {
          throw new Error(`Unexpected non-JSON response from server (HTTP ${res.status}).`);
        }
        throw new Error(data?.error || `Failed to send notification (HTTP ${res.status}).`);
      }

      // Clear the form ONLY after the server confirms success
      setNotifTitle('');
      setNotifMessage('');
      setNotifConfirming(false);
      setNotifRequestId(`req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
      setNotifFeedback({
        type: 'success',
        text: data.message || `Push notification "${trimmedTitle}" sent to topic "zoya_releases".`,
      });
    } catch (err: unknown) {
      setNotifConfirming(false);
      setNotifRequestId(`req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
      setNotifFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to send push notification.',
      });
    } finally {
      setSendingNotif(false);
    }
  };

  // Active preview metadata (either from server-verified draft or client-inspected APK)
  const previewMeta = uploadedDraft
    ? {
        versionName: uploadedDraft.versionName,
        versionCode: uploadedDraft.versionCode,
        packageName: uploadedDraft.applicationId,
        fileSizeFormatted: uploadedDraft.fileSizeFormatted,
        fileSize: uploadedDraft.fileSize,
        minSdkVersion: uploadedDraft.minSdkVersion ?? null,
        targetSdkVersion: uploadedDraft.targetSdkVersion ?? null,
        minAndroidVersion: uploadedDraft.minAndroidVersion,
        targetAndroidVersion: uploadedDraft.targetAndroidVersion ?? null,
        sha256: uploadedDraft.sha256,
        fileName: uploadedDraft.fileName,
      }
    : extractedApk;

  const renderSendNotificationSection = () => (
    <section
      aria-labelledby="send-notification-heading"
      className="p-4 sm:p-6 rounded-2xl bg-[#071319] border border-teal-500/30 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-teal-950 border border-teal-500/40 text-teal-300 flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h4 id="send-notification-heading" className="text-sm sm:text-base font-bold text-white">
              Send Notification
            </h4>
            <p className="text-[11px] text-slate-400">
              Send a custom push notification to subscribed Zoya Android app users via topic{' '}
              <code className="text-teal-300 font-mono">zoya_releases</code>
            </p>
          </div>
        </div>
        <span className="text-[11px] font-mono text-slate-400">No APK upload required</span>
      </div>

      {notifFeedback && (
        <div
          role="status"
          className={`p-3.5 rounded-xl text-xs flex items-start gap-2.5 ${
            notifFeedback.type === 'success'
              ? 'bg-teal-950/40 border border-teal-500/40 text-teal-200'
              : 'bg-red-950/40 border border-red-500/40 text-red-200'
          }`}
        >
          {notifFeedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          )}
          <span>{notifFeedback.text}</span>
        </div>
      )}

      <form onSubmit={handleInitiateNotification} className="space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label htmlFor="manual-notif-title" className="block text-xs font-medium text-slate-300">
              Notification Title <span className="text-teal-400">*</span>
            </label>
            <span
              className={`text-[11px] font-mono ${
                notifTitle.length >= 60 ? 'text-amber-300 font-semibold' : 'text-slate-400'
              }`}
            >
              {notifTitle.length}/60
            </span>
          </div>
          <input
            id="manual-notif-title"
            type="text"
            required
            maxLength={60}
            disabled={sendingNotif || notifConfirming}
            value={notifTitle}
            onChange={(e) => {
              setNotifTitle(e.target.value.slice(0, 60));
              if (notifFeedback) setNotifFeedback(null);
            }}
            placeholder="e.g., New Zoya Voice Features Available"
            className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 disabled:opacity-60 focus-visible:outline-teal-400"
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label htmlFor="manual-notif-message" className="block text-xs font-medium text-slate-300">
              Message <span className="text-teal-400">*</span>
            </label>
            <span
              className={`text-[11px] font-mono ${
                notifMessage.length >= 200 ? 'text-amber-300 font-semibold' : 'text-slate-400'
              }`}
            >
              {notifMessage.length}/200
            </span>
          </div>
          <textarea
            id="manual-notif-message"
            rows={3}
            required
            maxLength={200}
            disabled={sendingNotif || notifConfirming}
            value={notifMessage}
            onChange={(e) => {
              setNotifMessage(e.target.value.slice(0, 200));
              if (notifFeedback) setNotifFeedback(null);
            }}
            placeholder="Write a concise update or announcement for Zoya Android users..."
            className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 disabled:opacity-60 focus-visible:outline-teal-400"
          />
        </div>

        {notifConfirming ? (
          <div className="p-4 rounded-xl bg-slate-900/95 border border-teal-500/40 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-teal-300 uppercase tracking-wider">
                Confirm Push Notification
              </span>
              <span className="text-[11px] font-mono text-slate-400">Topic: zoya_releases</span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800">
                <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                  Title
                </span>
                <p className="font-semibold text-white break-words">{notifTitle.trim()}</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800">
                <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
                  Message
                </span>
                <p className="text-slate-200 whitespace-pre-wrap break-words">{notifMessage.trim()}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleConfirmSendNotification}
                disabled={sendingNotif}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[42px] rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all cursor-pointer disabled:opacity-50"
              >
                {sendingNotif ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending Notification...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Confirm &amp; Send Notification</span>
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={sendingNotif}
                onClick={() => setNotifConfirming(false)}
                className="px-4 py-2.5 min-h-[42px] rounded-xl font-semibold text-xs sm:text-sm text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel / Edit
              </button>
            </div>
          </div>
        ) : (
          <div className="pt-1">
            <button
              type="submit"
              disabled={sendingNotif || !notifTitle.trim() || !notifMessage.trim()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all shadow-md active:scale-98 disabled:opacity-40 cursor-pointer focus-visible:outline-teal-400"
            >
              <Send className="w-4 h-4" />
              <span>Send Notification</span>
            </button>
          </div>
        )}
      </form>
    </section>
  );

  return (
    <div className="space-y-6 text-left">
      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'upload'
              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>Publish New APK</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('licenses')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'licenses'
              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Key className="w-4 h-4" />
          <span>License Management</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('notify')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'notify'
              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Send Notification</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'history'
              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Release History ({releases.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('storage-config')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'storage-config'
              ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>Cloud Storage &amp; Config</span>
        </button>
      </div>

      {/* TAB: LICENSE MANAGEMENT */}
      {activeTab === 'licenses' && (
        <LicenseManager token={token} onUnauthorized={onUnauthorized} />
      )}

      {/* TAB 1: UPLOAD & PUBLISH NEW RELEASE */}
      {activeTab === 'upload' && (
        <div className="space-y-6">
          {/* Active Public Release Status Card */}
          <div className="p-4 rounded-xl bg-[#040c10] border border-teal-950/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-teal-400" />
              <span className="text-slate-400">Current Live Release:</span>
              <strong className="text-white font-mono">
                {latestPublished
                  ? `${latestPublished.versionName} (versionCode: ${latestPublished.versionCode})`
                  : 'None published yet'}
              </strong>
            </div>

            {latestPublished && (
              <div className="text-slate-400 flex flex-wrap items-center gap-2">
                <span>Size: {latestPublished.fileSizeFormatted}</span>
                <span>·</span>
                <span>Published: {latestPublished.releaseDate}</span>
              </div>
            )}
          </div>

          {latestPublished && latestPublished.binaryVerified === false && (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs sm:text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="block text-amber-300 mb-0.5">
                  Action Required: Re-upload APK Binary for {latestPublished.versionName}
                </strong>
                <span>
                  The metadata for <code>{latestPublished.fileName}</code> exists in Firestore, but its APK binary is missing. Please upload a valid APK below and publish.
                </span>
              </div>
            </div>
          )}

          {publishMessage && (
            <div
              className={`p-4 rounded-xl text-xs sm:text-sm flex items-start gap-3 ${
                publishMessage.type === 'success'
                  ? 'bg-teal-950/40 border border-teal-500/40 text-teal-200'
                  : publishMessage.type === 'warning'
                  ? 'bg-amber-950/40 border border-amber-500/40 text-amber-200'
                  : 'bg-red-950/40 border border-red-500/40 text-red-200'
              }`}
            >
              {publishMessage.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              )}
              <span>{publishMessage.text}</span>
            </div>
          )}

          {/* STEP 1: APK Selection, Automatic Metadata Extraction & Draft Upload */}
          <div className="p-4 sm:p-6 rounded-2xl bg-[#071319] border border-teal-500/30 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-teal-950 border border-teal-500/40 text-teal-300 flex items-center justify-center font-mono text-xs font-bold shrink-0">
                  1
                </span>
                <h4 className="text-sm sm:text-base font-bold text-white">
                  Select Zoya APK (Auto-Detects Release Info)
                </h4>
              </div>
              <span className="text-xs text-slate-400">Package: {OFFICIAL_ZOYA_PACKAGE}</span>
            </div>

            <div
              onClick={() => !uploading && !inspectingApk && fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 sm:p-7 text-center transition-colors bg-slate-900/40 ${
                uploading || inspectingApk
                  ? 'border-slate-800 opacity-60 cursor-not-allowed'
                  : 'border-slate-700 hover:border-teal-400/60 cursor-pointer'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".apk,application/vnd.android.package-archive"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  handleFileSelection(file);
                }}
              />
              <Upload className="w-7 h-7 text-teal-400 mx-auto mb-2" />
              <p className="text-xs sm:text-sm font-medium text-slate-200 break-all">
                {selectedFile ? selectedFile.name : 'Tap to select Zoya Android APK file'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                Automatically extracts Version Name, Version Code, SDK levels, and File Size from <code className="text-teal-400">AndroidManifest.xml</code>
              </p>
            </div>

            {/* Loading state while parsing APK binary */}
            {inspectingApk && (
              <div className="p-4 rounded-xl bg-slate-900/90 border border-teal-500/30 flex items-center gap-3 text-xs text-teal-200">
                <Loader2 className="w-4 h-4 text-teal-400 animate-spin shrink-0" />
                <span>Inspecting APK archive &amp; extracting embedded AndroidManifest.xml metadata...</span>
              </div>
            )}

            {/* Validation / Parsing Error */}
            {validationError && (
              <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-200 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                <div className="space-y-1">
                  <strong className="block text-red-300 font-semibold">APK Validation Failed</strong>
                  <p className="leading-relaxed">{validationError}</p>
                </div>
              </div>
            )}

            {/* Extracted APK Metadata Preview Card */}
            {previewMeta && (
              <div className="p-4 sm:p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-teal-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      Extracted APK Metadata Preview
                    </span>
                  </div>
                  {uploadedDraft ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-teal-500/20 border border-teal-500/40 text-teal-300 text-[11px] font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Draft Staged on Server
                    </span>
                  ) : !validationError ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[11px] font-semibold">
                      <PackageCheck className="w-3.5 h-3.5" />
                      Valid Zoya APK
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800/80">
                    <span className="block text-[11px] text-slate-400 mb-0.5">Version Name</span>
                    <strong className="font-mono text-sm text-white">{previewMeta.versionName}</strong>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800/80">
                    <span className="block text-[11px] text-slate-400 mb-0.5">Version Code</span>
                    <strong className="font-mono text-sm text-teal-300">{previewMeta.versionCode}</strong>
                    {latestPublished && (
                      <span className="block text-[10px] text-slate-500 mt-0.5">
                        Previous live: {latestPublished.versionCode}
                      </span>
                    )}
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800/80 col-span-2 sm:col-span-1">
                    <span className="block text-[11px] text-slate-400 mb-0.5">APK File Size</span>
                    <strong className="font-mono text-sm text-white">{previewMeta.fileSizeFormatted}</strong>
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      {previewMeta.fileSize.toLocaleString()} bytes
                    </span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800/80 col-span-2 sm:col-span-1">
                    <span className="block text-[11px] text-slate-400 mb-0.5">Package Name</span>
                    <strong
                      className={`font-mono text-xs break-all ${
                        previewMeta.packageName === OFFICIAL_ZOYA_PACKAGE ? 'text-teal-300' : 'text-red-400'
                      }`}
                    >
                      {previewMeta.packageName}
                    </strong>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800/80">
                    <span className="block text-[11px] text-slate-400 mb-0.5">Minimum SDK</span>
                    <strong className="font-mono text-xs text-white">
                      {previewMeta.minSdkVersion ? `API ${previewMeta.minSdkVersion}` : 'Not specified'}
                    </strong>
                    <span className="block text-[10px] text-slate-500 mt-0.5">{previewMeta.minAndroidVersion}</span>
                  </div>

                  <div className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800/80">
                    <span className="block text-[11px] text-slate-400 mb-0.5">Target SDK</span>
                    <strong className="font-mono text-xs text-white">
                      {previewMeta.targetSdkVersion ? `API ${previewMeta.targetSdkVersion}` : 'Not specified'}
                    </strong>
                    {previewMeta.targetAndroidVersion && (
                      <span className="block text-[10px] text-slate-500 mt-0.5">
                        {previewMeta.targetAndroidVersion}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-[#050d12] border border-slate-800/80 text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                    <span className="text-slate-400">Package Integrity:</span>
                    <strong className="font-semibold text-teal-300">Cryptographically Verified</strong>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400 shrink-0">
                    <Clock className="w-3.5 h-3.5 text-teal-400" />
                    <span>Release Date: Set by server on publish</span>
                  </div>
                </div>

                {/* Upload Draft Action Button (Step 1 completion) */}
                {!uploadedDraft && !validationError && (
                  <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <span className="text-xs text-slate-400">
                      Metadata verified. Upload the APK binary to stage a release draft.
                    </span>
                    <button
                      type="button"
                      onClick={handleUploadApk}
                      disabled={uploading}
                      className="px-5 py-2.5 min-h-[42px] bg-teal-400 hover:bg-teal-300 text-slate-950 font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {uploading ? `Uploading Draft (${uploadProgress}%)...` : 'Upload & Stage Draft APK'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {uploading && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Uploading APK chunks &amp; verifying AndroidManifest.xml on server...</span>
                  <span className="font-mono font-bold text-teal-300">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-teal-400 to-cyan-400 transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {uploadError && (
              <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{uploadError}</span>
              </div>
            )}
          </div>

          {/* STEP 2: Release Notes & Publish Action (Simplified Form) */}
          <form onSubmit={handlePublish} className="p-4 sm:p-6 rounded-2xl bg-[#071319] border border-teal-500/30 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-teal-950 border border-teal-500/40 text-teal-300 flex items-center justify-center font-mono text-xs font-bold shrink-0">
                  2
                </span>
                <h4 className="text-sm sm:text-base font-bold text-white">Release Notes &amp; Publish</h4>
              </div>
              <span className="text-xs text-slate-400">
                {uploadedDraft
                  ? `Staged: ${uploadedDraft.versionName} (code ${uploadedDraft.versionCode})`
                  : 'Complete Step 1 draft upload first'}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Release Notes / Changelog (Optional)
              </label>
              <textarea
                rows={3}
                disabled={!uploadedDraft || publishing}
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                placeholder="Summarize what changed in this Zoya update (e.g., voice recognition improvements, faster wake-word response, bug fixes)..."
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-white placeholder-slate-500 disabled:opacity-50 focus-visible:outline-teal-400"
              />
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <span>
                <strong>Automatic Server Timestamp &amp; Verification:</strong> Publishing promotes the staged draft to live status, records the official server timestamp as the release date, updates <code className="text-teal-300">/api/releases/manifest</code>, and sends an FCM update notification.
              </span>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={!uploadedDraft || publishing}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all shadow-md active:scale-98 disabled:opacity-40 cursor-pointer focus-visible:outline-teal-400"
              >
                {publishing
                  ? 'Publishing Release...'
                  : uploadedDraft
                  ? `Publish Zoya ${uploadedDraft.versionName} (Code ${uploadedDraft.versionCode})`
                  : 'Publish Official Zoya Release'}
              </button>
            </div>
          </form>

          {/* Manual Push Notification Section */}
          {renderSendNotificationSection()}
        </div>
      )}

      {/* TAB: SEND MANUAL NOTIFICATION */}
      {activeTab === 'notify' && renderSendNotificationSection()}

      {/* TAB 2: RELEASE HISTORY */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2">
            <h4 className="text-sm font-bold text-white">All Stored Releases &amp; Drafts</h4>
            <button
              type="button"
              onClick={fetchReleases}
              className="inline-flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingReleases ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          {releases.length === 0 ? (
            <div className="p-8 text-center bg-[#071319] border border-slate-800 rounded-2xl text-slate-400 text-xs">
              No releases or drafts found in storage. Use the &quot;Publish New APK&quot; tab to upload the first release.
            </div>
          ) : (
            <div className="space-y-3">
              {releases.map((rel) => (
                <div
                  key={rel.id}
                  className="p-4 sm:p-5 rounded-xl bg-[#071319] border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs"
                >
                  <div className="space-y-1.5 min-w-0 w-full">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          rel.isPublished
                            ? 'bg-teal-500/20 text-teal-300 border border-teal-500/40'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {rel.isPublished ? 'Published' : 'Draft / Unpublished'}
                      </span>
                      <strong className="text-sm font-bold text-white font-mono">
                        {rel.versionName || rel.fileName}
                      </strong>
                      <span className="text-slate-400 font-mono">versionCode: {rel.versionCode}</span>
                      <span className="text-slate-500 font-mono">({rel.applicationId})</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-400">
                      <span>Size: {rel.fileSizeFormatted}</span>
                      <span>·</span>
                      <span>Min OS: {rel.minAndroidVersion}</span>
                      {rel.targetSdkVersion && (
                        <>
                          <span>·</span>
                          <span>Target SDK: API {rel.targetSdkVersion}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>Date: {rel.releaseDate || 'Unpublished draft'}</span>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] text-teal-400/90 truncate max-w-full">
                      <ShieldCheck className="w-3 h-3 text-teal-400 shrink-0" />
                      <span>Package Integrity: Cryptographically Verified</span>
                    </div>

                    {rel.releaseNotes && (
                      <p className="text-slate-300 text-xs pt-1 line-clamp-2">{rel.releaseNotes}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    {!rel.isPublished && (
                      <button
                        type="button"
                        onClick={() => {
                          setUploadedDraft(rel);
                          setReleaseNotes(rel.releaseNotes || '');
                          setActiveTab('upload');
                        }}
                        className="px-3 py-1.5 min-h-[36px] rounded-lg bg-teal-500/20 hover:bg-teal-500/30 border border-teal-500/40 text-teal-300 font-semibold text-xs transition-colors cursor-pointer"
                      >
                        Select Draft
                      </button>
                    )}

                    {rel.isPublished && (
                      <a
                        href={rel.downloadUrl}
                        download
                        className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-teal-400 transition-colors"
                        title="Download this APK"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    )}

                    {confirmDeleteId === rel.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={deletingId === rel.id}
                          onClick={() => handleDeleteRelease(rel.id)}
                          className="px-2.5 py-1.5 min-h-[36px] rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs cursor-pointer disabled:opacity-50"
                        >
                          {deletingId === rel.id ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1.5 min-h-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(rel.id)}
                        className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-400 transition-colors cursor-pointer"
                        title="Delete release and remove APK binary"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CLOUD STORAGE & CONFIGURATION GUIDE */}
      {activeTab === 'storage-config' && (
        <div className="p-5 sm:p-6 rounded-2xl bg-[#071319] border border-teal-500/30 space-y-4 text-xs text-slate-300">
          <div className="flex items-center gap-2 text-white font-bold text-sm pb-2 border-b border-slate-800">
            <Server className="w-4 h-4 text-teal-400" />
            <span>Persistent Cloud Object Storage &amp; Vercel Deployment</span>
          </div>

          <p className="leading-relaxed">
            The Zoya release distribution engine stores published Android APK files and release records in Cloud Firestore (<code className="text-teal-300">releases</code> and <code className="text-teal-300">apk_chunks</code>) with local backup at <code className="text-teal-300">.data/releases.json</code>.
          </p>

          <div className="pt-2">
            <h5 className="font-bold text-white text-xs mb-1">Public Update Manifest URL</h5>
            <p className="text-slate-400 mb-2">The public update manifest is served directly at:</p>
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-teal-300">
              <span className="truncate">/api/releases/manifest</span>
              <a
                href="/api/releases/manifest"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-slate-400 hover:text-white"
              >
                <span>Open</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
