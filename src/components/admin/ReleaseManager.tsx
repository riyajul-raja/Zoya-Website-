import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Calendar,
  Layers,
  HardDrive,
  Trash2,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Server,
  Download,
  AlertCircle,
  Clock,
  Sparkles
} from 'lucide-react';
import { ReleaseMetadata } from '../../../server/storage';

interface ReleaseManagerProps {
  token: string;
  onReleasePublished: () => void;
}

export const ReleaseManager: React.FC<ReleaseManagerProps> = ({ token, onReleasePublished }) => {
  const [releases, setReleases] = useState<ReleaseMetadata[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(true);
  const [activeTab, setActiveTab] = useState<'upload' | 'history' | 'storage-config'>('upload');

  // Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedDraft, setUploadedDraft] = useState<ReleaseMetadata | null>(null);

  // Publish Form State
  const [versionName, setVersionName] = useState('');
  const [versionCode, setVersionCode] = useState<number | ''>('');
  const [applicationId, setApplicationId] = useState('com.riyajul.zoya');
  const [minAndroidVersion, setMinAndroidVersion] = useState('Android 8.0 (API 26)+');
  const [releaseDate, setReleaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [releaseNotes, setReleaseNotes] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchReleases = async () => {
    setLoadingReleases(true);
    try {
      const res = await fetch('/api/admin/releases', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.ok && data.success) {
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

  // Identify latest published release for version code comparison
  const publishedReleases = releases.filter((r) => r.isPublished);
  const latestPublished = publishedReleases.length > 0
    ? [...publishedReleases].sort((a, b) => b.versionCode - a.versionCode)[0]
    : null;

  // Real upload using XMLHttpRequest to stream bytes and observe actual upload progress
  const handleUploadApk = () => {
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.apk')) {
      setUploadError('Invalid file: File must have a .apk extension.');
      return;
    }

    setUploadError(null);
    setUploadProgress(0);
    setUploading(true);
    setUploadedDraft(null);
    setPublishMessage(null);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/upload', true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('x-filename', encodeURIComponent(selectedFile.name));
    xhr.setRequestHeader('Content-Type', 'application/vnd.android.package-archive');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      setUploading(false);
      try {
        const response = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && response.success) {
          setUploadedDraft(response.draft);
          // Suggest initial version name from filename if matches format like zoya-v1.0.0.apk
          const match = selectedFile.name.match(/v?(\d+\.\d+(\.\d+)?)/i);
          if (match && !versionName) {
            setVersionName(match[0].startsWith('v') ? match[0] : `v${match[0]}`);
          }
          if (latestPublished && (!versionCode || versionCode <= latestPublished.versionCode)) {
            setVersionCode(latestPublished.versionCode + 1);
          } else if (!versionCode) {
            setVersionCode(1);
          }
          fetchReleases();
        } else {
          setUploadError(response.error || 'Upload failed on server.');
        }
      } catch (err) {
        setUploadError('Unexpected server response during upload.');
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setUploadError('Network error occurred during APK upload.');
    };

    xhr.send(selectedFile);
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadedDraft) return;

    if (!versionName.trim()) {
      setPublishMessage({ type: 'error', text: 'Version name is required (e.g. v1.0.0).' });
      return;
    }

    if (!versionCode || Number(versionCode) <= 0) {
      setPublishMessage({ type: 'error', text: 'Android versionCode must be a positive integer.' });
      return;
    }

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
          versionName: versionName.trim(),
          versionCode: Number(versionCode),
          applicationId: applicationId.trim(),
          releaseNotes: releaseNotes.trim(),
          minAndroidVersion,
          releaseDate,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to publish release');
      }

      setPublishMessage({
        type: data.warning ? 'warning' : 'success',
        text: data.warning
          ? `Release published successfully! ${data.warning}`
          : `Release ${versionName} published successfully! The public download button and manifest are now updated live.`,
      });

      // Reset upload state
      setSelectedFile(null);
      setUploadedDraft(null);
      setVersionName('');
      setVersionCode('');
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

  const handleDeleteRelease = async (id: string, versionName: string) => {
    if (!confirm(`Are you sure you want to delete release ${versionName || id}? This will remove the APK file from storage.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/releases/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        fetchReleases();
        onReleasePublished();
      } else {
        alert(data.error || 'Could not delete release');
      }
    } catch (err) {
      alert('Network error when attempting to delete release');
    }
  };

  // Check version code warning
  const isVersionCodeLowerOrEqual = latestPublished && versionCode && Number(versionCode) <= latestPublished.versionCode;

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

      {/* TAB 1: UPLOAD & PUBLISH NEW RELEASE */}
      {activeTab === 'upload' && (
        <div className="space-y-6">
          {/* Active Public Release Status Card */}
          <div className="p-4 rounded-xl bg-[#040c10] border border-teal-950/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <div className="w-2.5 h-2.5 rounded-full bg-teal-400" />
              <span className="text-slate-400">Current Live Release:</span>
              <strong className="text-white font-mono">
                {latestPublished ? `${latestPublished.versionName} (code: ${latestPublished.versionCode})` : 'None published yet'}
              </strong>
            </div>

            {latestPublished && (
              <div className="text-slate-400 flex items-center gap-2">
                <span>Size: {latestPublished.fileSizeFormatted}</span>
                <span>·</span>
                <span>Date: {latestPublished.releaseDate}</span>
              </div>
            )}
          </div>

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

          {/* STEP 1: APK File Upload Container */}
          <div className="p-5 sm:p-6 rounded-2xl bg-[#071319] border border-teal-500/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-teal-950 border border-teal-500/40 text-teal-300 flex items-center justify-center font-mono text-xs font-bold">
                  1
                </span>
                <h4 className="text-base font-bold text-white">Select and Upload Android APK</h4>
              </div>
              <span className="text-xs text-slate-400">Max size: 150 MB</span>
            </div>

            <div className="space-y-4">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-teal-400/60 rounded-xl p-6 sm:p-8 text-center cursor-pointer transition-colors bg-slate-900/40"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".apk,application/vnd.android.package-archive"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setSelectedFile(file);
                    setUploadError(null);
                    setUploadedDraft(null);
                  }}
                />
                <Upload className="w-8 h-8 text-teal-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-200">
                  {selectedFile ? selectedFile.name : 'Click or drag Zoya APK binary here'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Supported formats: Standalone signed <code className="text-teal-400">.apk</code>
                </p>
              </div>

              {selectedFile && !uploadedDraft && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-slate-900 rounded-xl border border-slate-800 text-xs">
                  <div>
                    <span className="text-slate-400">Selected File: </span>
                    <strong className="text-white font-mono">{selectedFile.name}</strong>
                    <span className="text-slate-500 ml-2">({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleUploadApk}
                    disabled={uploading}
                    className="w-full sm:w-auto px-4 py-2 min-h-[40px] bg-teal-400 hover:bg-teal-300 text-slate-950 font-bold rounded-lg transition-all cursor-pointer disabled:opacity-50"
                  >
                    {uploading ? `Uploading (${uploadProgress}%)` : 'Start Secure Upload'}
                  </button>
                </div>
              )}

              {uploading && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Uploading APK to server...</span>
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

              {uploadedDraft && (
                <div className="p-4 rounded-xl bg-teal-950/30 border border-teal-500/40 space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-teal-300 font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-teal-400" />
                    <span>APK Upload Verified by Server</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300 pt-1">
                    <div>
                      File Size: <strong className="font-mono text-white">{uploadedDraft.fileSizeFormatted}</strong>
                    </div>
                    <div className="truncate">
                      Package Name: <strong className="font-mono text-white">{uploadedDraft.fileName}</strong>
                    </div>
                    <div className="sm:col-span-2 truncate">
                      Genuine SHA-256: <strong className="font-mono text-teal-300">{uploadedDraft.sha256}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* STEP 2: Release Metadata & Publishing Form */}
          <form onSubmit={handlePublish} className="p-5 sm:p-6 rounded-2xl bg-[#071319] border border-teal-500/30 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-teal-950 border border-teal-500/40 text-teal-300 flex items-center justify-center font-mono text-xs font-bold">
                  2
                </span>
                <h4 className="text-base font-bold text-white">Enter Release Specifications &amp; Publish</h4>
              </div>
              <span className="text-xs text-slate-400">
                {uploadedDraft ? 'Ready for publication' : 'Requires Step 1 upload first'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Version Name (e.g. v1.0.0, v0.9.3-beta) *
                </label>
                <input
                  type="text"
                  required
                  disabled={!uploadedDraft}
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  placeholder="v1.0.0"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 disabled:opacity-50 focus-visible:outline-teal-400"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Android versionCode (Integer) *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  disabled={!uploadedDraft}
                  value={versionCode}
                  onChange={(e) => setVersionCode(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  placeholder="100"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 disabled:opacity-50 focus-visible:outline-teal-400"
                />
                <div className="text-[11px] text-slate-500 mt-1">
                  Must be strictly incremented for in-place Android updates.
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Android Application ID
                </label>
                <input
                  type="text"
                  required
                  disabled={!uploadedDraft}
                  value={applicationId}
                  onChange={(e) => setApplicationId(e.target.value)}
                  placeholder="com.riyajul.zoya"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 disabled:opacity-50 focus-visible:outline-teal-400 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Minimum Android OS Target
                </label>
                <select
                  disabled={!uploadedDraft}
                  value={minAndroidVersion}
                  onChange={(e) => setMinAndroidVersion(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white disabled:opacity-50 focus-visible:outline-teal-400"
                >
                  <option value="Android 8.0 (API 26)+">Android 8.0 (Oreo, API 26)+</option>
                  <option value="Android 9.0 (API 28)+">Android 9.0 (Pie, API 28)+</option>
                  <option value="Android 10.0 (API 29)+">Android 10.0 (Q, API 29)+</option>
                  <option value="Android 11.0 (API 30)+">Android 11.0 (R, API 30)+</option>
                  <option value="Android 12.0 (API 31)+">Android 12.0 (S, API 31)+</option>
                  <option value="Android 13.0 (API 33)+">Android 13.0 (T, API 33)+</option>
                  <option value="Android 14.0 (API 34)+">Android 14.0 (U, API 34)+</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Release Date
                </label>
                <input
                  type="date"
                  required
                  disabled={!uploadedDraft}
                  value={releaseDate}
                  onChange={(e) => setReleaseDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white disabled:opacity-50 focus-visible:outline-teal-400"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Release Notes / Changelog
                </label>
                <textarea
                  rows={4}
                  disabled={!uploadedDraft}
                  value={releaseNotes}
                  onChange={(e) => setReleaseNotes(e.target.value)}
                  placeholder="Detail the key improvements, bug fixes, and voice engine updates in this build..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 disabled:opacity-50 focus-visible:outline-teal-400"
                />
              </div>
            </div>

            {/* Android Update Compatibility Warning */}
            {isVersionCodeLowerOrEqual && (
              <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/50 flex items-start gap-3 text-xs text-amber-200">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <strong className="text-white block font-semibold mb-0.5">Android Update Compatibility Warning:</strong>
                  The entered versionCode ({versionCode}) is not higher than the latest published release ({latestPublished?.versionCode}). Android operating systems require newer builds to have a strictly higher versionCode in order to perform an update without uninstalling the previous app.
                </div>
              </div>
            )}

            {/* Keystore Signing Callout */}
            <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <span>
                <strong>Keystore Integrity:</strong> In order for Android users to install this APK over an existing installation, the APK must be signed with the exact same production keystore certificate and share package ID <code className="text-teal-300">com.riyajul.zoya</code>.
              </span>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={!uploadedDraft || publishing}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 min-h-[44px] rounded-xl font-bold text-sm text-slate-950 bg-gradient-to-r from-teal-400 to-cyan-400 hover:from-teal-300 hover:to-cyan-300 transition-all shadow-md active:scale-98 disabled:opacity-40 cursor-pointer focus-visible:outline-teal-400"
              >
                {publishing ? 'Publishing Release...' : 'Publish Official Zoya Release'}
              </button>
            </div>
          </form>
        </div>
      )}

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
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
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
                      <span className="text-slate-400">code: {rel.versionCode}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-400">
                      <span>Size: {rel.fileSizeFormatted}</span>
                      <span>·</span>
                      <span>Target: {rel.minAndroidVersion}</span>
                      <span>·</span>
                      <span>Date: {rel.releaseDate}</span>
                    </div>

                    <div className="font-mono text-[10px] text-slate-500 truncate max-w-[180px] xs:max-w-xs sm:max-w-md md:max-w-lg">
                      SHA-256: {rel.sha256}
                    </div>

                    {rel.releaseNotes && (
                      <p className="text-slate-300 text-xs pt-1 line-clamp-2">
                        {rel.releaseNotes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
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

                    <button
                      type="button"
                      onClick={() => handleDeleteRelease(rel.id, rel.versionName)}
                      className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-400 transition-colors cursor-pointer"
                      title="Delete release and remove APK binary"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
            The Zoya release distribution engine stores published Android APK files and release records. In this environment, local persistent storage is active at <code className="text-teal-300">.data/apks/</code> and <code className="text-teal-300">.data/releases.json</code>.
          </p>

          <h5 className="font-bold text-white text-xs pt-2">Required Production Environment Variables</h5>
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-[11px] space-y-1 text-slate-300">
            <div><span className="text-teal-400">ADMIN_EMAIL</span>=&quot;riyajulansari113b@gmail.com&quot;</div>
            <div><span className="text-teal-400">ADMIN_PASSWORD</span>=&quot;&lt;your_strong_password&gt;&quot;</div>
            <div><span className="text-teal-400">ADMIN_JWT_SECRET</span>=&quot;&lt;long_random_secret_string&gt;&quot;</div>
            <div><span className="text-cyan-400">STORAGE_PROVIDER</span>=&quot;s3&quot; # or &quot;r2&quot; / &quot;vercel-blob&quot;</div>
            <div><span className="text-cyan-400">S3_BUCKET</span>=&quot;zoya-releases&quot;</div>
            <div><span className="text-cyan-400">S3_REGION</span>=&quot;auto&quot;</div>
            <div><span className="text-cyan-400">S3_ENDPOINT</span>=&quot;https://...&quot;</div>
            <div><span className="text-cyan-400">S3_ACCESS_KEY_ID</span>=&quot;...&quot;</div>
            <div><span className="text-cyan-400">S3_SECRET_ACCESS_KEY</span>=&quot;...&quot;</div>
          </div>

          <div className="pt-2">
            <h5 className="font-bold text-white text-xs mb-1">Public Update Manifest URL</h5>
            <p className="text-slate-400 mb-2">
              The public update manifest is served directly at:
            </p>
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
