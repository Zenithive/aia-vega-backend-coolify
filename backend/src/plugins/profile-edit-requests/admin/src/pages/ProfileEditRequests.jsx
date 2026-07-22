// @ts-nocheck
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Layouts } from '@strapi/strapi/admin';
import {
  Box,
  Typography,
  Button,
  Flex,
  Loader,
  Badge,
  SingleSelect,
  SingleSelectOption,
  Modal,
} from '@strapi/design-system';
import { getFetchClient } from '@strapi/strapi/admin';
import DataTable from '../../../../analytics-dashboard/admin/src/components/DataTable';
import DateRangeInput from '../../../../analytics-dashboard/admin/src/components/DateRangeInput';

const DEFAULT_PAGE_SIZE = 10;
const TABLE_FONT_STYLE = { fontSize: '14px' };
const REJECTION_REASON_COLUMN_MAX_WIDTH = 450;
const REJECTION_REASON_COLUMN_MIN_WIDTH = 170;
const COMPANY_COLUMN_WIDTH = 50;
const COMPANY_OPTIONS = [
  { value: '', label: 'All Companies' },
  { value: 'AIA', label: 'AIA' },
  { value: 'VEGA', label: 'VEGA' },
];
const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
];

const normalizeRejectionReason = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export default function ProfileEditRequestsPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [dateRange, setDateRange] = useState({ start: null, end: null });
  const [mediaCache, setMediaCache] = useState({}); // Cache for media URLs
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionReasonError, setRejectionReasonError] = useState('');
  const [showRejectReasonInput, setShowRejectReasonInput] = useState(false);
  const [pendingComment, setPendingComment] = useState('');
  const [pendingCommentError, setPendingCommentError] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [locationOptions, setLocationOptions] = useState([]);
  
  const { get, put, post } = getFetchClient();
  const isMounted = useRef(true);

  const fetchList = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await get('/profile-edit-requests/requests');
      const rows = Array.isArray(data.data) ? data.data : (data.results || data) || [];
      if (isMounted.current) {
        setList(Array.isArray(rows) ? rows : []);
      }
    } catch (e) {
      if (isMounted.current) {
        setError(e.message || 'Failed to load');
        setList([]);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchList();
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchLocationOptions = async (company = companyFilter) => {
    try {
      const query = company ? `?company=${encodeURIComponent(company)}` : '';
      const { data } = await get(`/profile-edit-requests/requests/locations${query}`);
      const locations = Array.isArray(data?.data) ? data.data : [];
      if (isMounted.current) {
        setLocationOptions(locations);
        if (locationFilter && !locations.includes(locationFilter)) {
          setLocationFilter('');
        }
      }
    } catch (e) {
      if (isMounted.current) {
        setLocationOptions([]);
      }
    }
  };

  useEffect(() => {
    fetchLocationOptions(companyFilter);
  }, [companyFilter]);

  const updateStatus = async (documentId, newStatus, options = {}) => {
    const id = documentId != null ? String(documentId) : null;
    if (!id) return;
    setUpdatingId(id);
    setError(null);
    try {
      const normalizedReason = normalizeRejectionReason(options.reason_for_rejection);
      await put(`/profile-edit-requests/requests/${encodeURIComponent(id)}`, {
        data: {
          request_status: newStatus,
          ...(newStatus === 'Rejected' ? { reason_for_rejection: normalizedReason } : {}),
        },
      });
      
      if (isMounted.current) {
        setList((prev) =>
          prev.map((e) => {
            const eid = e.documentId ?? e.id ?? e._id;
            if (eid == null || String(eid) !== id) return e;
            return {
              ...e,
              request_status: newStatus,
              reason_for_rejection: newStatus === 'Rejected' ? normalizedReason : null,
            };
          })
        );
        await fetchList();
        setShowModal(false);
        setSelectedRequest(null);
        setRejectionReason('');
        setRejectionReasonError('');
        setShowRejectReasonInput(false);
      }
    } catch (e) {
      if (isMounted.current) {
        setError(e.message || 'Update failed');
      }
    } finally {
      if (isMounted.current) {
        setUpdatingId(null);
      }
    }
  };

  const addPendingComment = async (documentId, comment) => {
    const id = documentId != null ? String(documentId) : null;
    if (!id) return;
    setUpdatingId(id);
    setError(null);
    try {
      const normalizedComment = normalizeRejectionReason(comment);
      const { data } = await post(`/profile-edit-requests/requests/${encodeURIComponent(id)}/pending-comment`, {
        data: { comment: normalizedComment },
      });
      const updatedComments = data?.data?.pending_admin_comments || [];

      if (isMounted.current) {
        setList((prev) =>
          prev.map((e) => {
            const eid = e.documentId ?? e.id ?? e._id;
            if (eid == null || String(eid) !== id) return e;
            return {
              ...e,
              pending_admin_comments: updatedComments,
              latest_pending_comment: data?.data?.latest_pending_comment || normalizedComment,
            };
          })
        );
        setSelectedRequest((prev) => {
          if (!prev) return prev;
          const prevId = entryId(prev);
          if (prevId == null || String(prevId) !== id) return prev;
          return {
            ...prev,
            pending_admin_comments: updatedComments,
            latest_pending_comment: data?.data?.latest_pending_comment || normalizedComment,
          };
        });
        setPendingComment('');
        setPendingCommentError('');
      }
    } catch (e) {
      if (isMounted.current) {
        setError(e.message || 'Failed to send comment');
      }
    } finally {
      if (isMounted.current) {
        setUpdatingId(null);
      }
    }
  };

  const entryId = (entry) => entry.documentId ?? entry.id ?? entry._id;

  const getStatusValue = (entry) => {
    const attrs = entry?.attributes || entry || {};
    return attrs.request_status ?? entry?.request_status ?? 'Pending';
  };

  const getEmployeeIdentifier = (entry) => {
    const attrs = entry?.attributes || entry || {};
    const user = attrs.users_permissions_user?.data ?? attrs.users_permissions_user ?? {};
    const userAttrs = user.attributes ?? user;
    const company = String(userAttrs.company || attrs.company || '').toLowerCase();

    if (company === 'aia') return userAttrs.emp_code || '—';
    if (company === 'vega') return userAttrs.emp_id || '—';
    return userAttrs.emp_code || userAttrs.emp_id || user.id || attrs.userId || entry?.userId || '—';
  };

  const getDisplayValues = (entry) => {
    const attrs = entry.attributes || entry;
    const user = attrs.users_permissions_user?.data ?? attrs.users_permissions_user ?? {};
    const userAttrs = user.attributes ?? user;
    const userName = attrs.requester_name ?? userAttrs.username ?? userAttrs.email ?? userAttrs.employee_name ?? '—';
    const userId = getEmployeeIdentifier(entry);
    const requestedChanges = attrs.requested_changes ?? entry.requested_changes ?? {};
    // Prefer company from user, fallback to company on request
    const userCompany = userAttrs.company || attrs.company || attrs.companyName || '';
    return { userName, userId, requestedChanges, attrs, userCompany };
  };

  const getUserLocationValue = (entry) => {
    const attrs = entry?.attributes || entry || {};
    if (attrs.user_location) return attrs.user_location;
    if (entry?.user_location) return entry.user_location;

    const user = attrs.users_permissions_user?.data ?? attrs.users_permissions_user ?? {};
    const userAttrs = user.attributes ?? user;
    const company = String(userAttrs.company || attrs.company || '').toLowerCase();
    if (company === 'aia') return userAttrs.branch || '—';
    if (company === 'vega') return userAttrs.working_location || '—';
    return userAttrs.branch || userAttrs.working_location || '—';
  };

  const getPendingComments = (entry) => {
    const attrs = entry?.attributes || entry || {};
    const comments = attrs.pending_admin_comments ?? entry?.pending_admin_comments;
    return Array.isArray(comments) ? comments : [];
  };

  const getPendingCommentsTooltipText = (entry) => {
    const comments = getPendingComments(entry);
    if (comments.length === 0) return '';

    return comments
      .map((item, index) => {
        const text = typeof item?.comment === 'string' ? item.comment.trim() : '';
        if (!text) return null;
        const author = item?.commented_by?.name || 'Admin';
        const when = item?.commented_at
          ? new Date(item.commented_at).toLocaleString()
          : '';
        const prefix = comments.length > 1 ? `${index + 1}. ` : '';
        return when
          ? `${prefix}${author} (${when}): ${text}`
          : `${prefix}${author}: ${text}`;
      })
      .filter(Boolean)
      .join('\n\n');
  };

  const formatChangeValue = (value) => {
    if (value == null || value === '') return 'empty';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const toAbsoluteMediaUrl = (url) => {
    if (!url || typeof url !== 'string') return null;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/')) return `${window.location.origin}${url}`;
    return `${window.location.origin}/${url}`;
  };

  const getPhotographExportText = (value) => {
    if (value == null || value === '') return 'empty';

    if (typeof value === 'number') {
      const mediaUrl = toAbsoluteMediaUrl(mediaCache[value]);
      return mediaUrl || `Photo updated (media ${value})`;
    }

    if (typeof value === 'string') {
      const asUrl = toAbsoluteMediaUrl(value);
      return asUrl || value;
    }

    if (typeof value === 'object') {
      const mediaUrl = toAbsoluteMediaUrl(value.url || value.previewUrl);
      if (mediaUrl) return mediaUrl;
      if (value.id != null) return `Photo updated (media ${value.id})`;
    }

    return formatChangeValue(value);
  };

  const getChangesExportText = (entry) => {
    const attrs = entry?.attributes || entry || {};
    const requestedChanges = attrs.requested_changes && typeof attrs.requested_changes === 'object'
      ? attrs.requested_changes
      : {};
    const previousValues = attrs.previous_values && typeof attrs.previous_values === 'object'
      ? attrs.previous_values
      : {};

    const fields = Object.keys(requestedChanges);
    if (fields.length === 0) return 'No changes';

    return fields
      .map((field) => {
        const newValue = field === 'photograph'
          ? getPhotographExportText(requestedChanges[field])
          : formatChangeValue(requestedChanges[field]);
        if (Object.prototype.hasOwnProperty.call(previousValues, field)) {
          const oldValue = field === 'photograph'
            ? getPhotographExportText(previousValues[field])
            : formatChangeValue(previousValues[field]);
          return `${field}: ${oldValue} -> ${newValue}`;
        }
        return `${field}: ${newValue}`;
      })
      .join('\n');
  };

  const filteredList = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    const company = (companyFilter || '').trim();
    const status = (statusFilter || '').trim();
    const location = (locationFilter || '').trim();
    return list.filter((entry) => {
      const { userName, userCompany, attrs } = getDisplayValues(entry);
      const entryIdVal = entry.documentId ?? entry.id ?? entry._id;
      const rowStatus = getStatusValue(entry);
      const rowLocation = getUserLocationValue(entry);

      if (status && rowStatus !== status) return false;

      if (location && rowLocation !== location) return false;

      // Company filtering
      if (company) {
        if (!userCompany || userCompany.toLowerCase() !== company.toLowerCase()) return false;
      }
      // Date range filtering
      if (dateRange && dateRange.start && attrs.createdAt && new Date(attrs.createdAt) < dateRange.start) return false;
      if (dateRange && dateRange.end && attrs.createdAt && new Date(attrs.createdAt) > dateRange.end) return false;
      if (!q) return true;
      // Enhanced search: allow searching by name, emp_code, emp_id, user id, and request id
      const userAttrs = attrs.users_permissions_user?.data?.attributes || attrs.users_permissions_user?.attributes || attrs.users_permissions_user || {};
      const matches = (
        (userName && userName.toLowerCase().includes(q)) ||
        (userAttrs.firstname && userAttrs.firstname.toLowerCase().includes(q)) ||
        (userAttrs.lastname && userAttrs.lastname.toLowerCase().includes(q)) ||
        (userAttrs.emp_code && String(userAttrs.emp_code).toLowerCase().includes(q)) ||
        (userAttrs.emp_id && String(userAttrs.emp_id).toLowerCase().includes(q)) ||
        (userAttrs.id && String(userAttrs.id).toLowerCase().includes(q)) ||
        (entryIdVal && String(entryIdVal).toLowerCase().includes(q))
      );
      // Company-specific strictness (optional: keep for digit/EMP pattern enforcement)
      if (company.toLowerCase() === 'aia' && /^\d+$/.test(q)) {
        return userAttrs.emp_code && String(userAttrs.emp_code).includes(q);
      } else if (company.toLowerCase() === 'vega' && /^emp\d+$/i.test(q)) {
        return userAttrs.emp_id && String(userAttrs.emp_id).toLowerCase().includes(q);
      }
      // Otherwise, allow match by any of the above
      return matches;
    });
  }, [list, search, companyFilter, statusFilter, locationFilter, dateRange]);

  const totalFiltered = filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageList = filteredList.slice(start, start + pageSize);
  const shouldShowRejectionReasonColumn = statusFilter !== 'Pending' && filteredList.some(
    (entry) => getStatusValue(entry) !== 'Approved'
  );

  useEffect(() => {
    if (currentPage !== page) setPage(currentPage);
  }, [currentPage, page]);

  const viewChanges = (entry) => {
    setSelectedRequest(entry);
    setShowModal(true);
    // Clear media cache when opening a new request
    setMediaCache({});
    setRejectionReason('');
    setRejectionReasonError('');
    setShowRejectReasonInput(false);
    setPendingComment('');
    setPendingCommentError('');
  };

  const handleApprove = async () => {
    if (!selectedRequest) return;
    const id = entryId(selectedRequest);
    if (!id) return;
    setShowRejectReasonInput(false);
    setRejectionReasonError('');
    await updateStatus(id, 'Approved');
  };

  const handleStartReject = () => {
    setShowRejectReasonInput(true);
    setRejectionReasonError('');
  };

  const handleCancelReject = () => {
    setShowRejectReasonInput(false);
    setRejectionReason('');
    setRejectionReasonError('');
  };

  const handleConfirmReject = async () => {
    if (!selectedRequest) return;
    const id = entryId(selectedRequest);
    if (!id) return;

    const normalizedReason = normalizeRejectionReason(rejectionReason);
    if (!normalizedReason) {
      setRejectionReasonError('Reason for rejection is required.');
      return;
    }

    setRejectionReasonError('');
    await updateStatus(id, 'Rejected', { reason_for_rejection: normalizedReason });
  };

  const handleSendPendingComment = async () => {
    if (!selectedRequest) return;
    const id = entryId(selectedRequest);
    if (!id) return;

    const normalizedComment = normalizeRejectionReason(pendingComment);
    if (!normalizedComment) {
      setPendingCommentError('Comment is required.');
      return;
    }

    setPendingCommentError('');
    await addPendingComment(id, normalizedComment);
  };

  const MEDIA_FIELDS = ['photograph'];

  const fetchMediaUrl = async (mediaId) => {
    if (!mediaId || typeof mediaId !== 'number') return null;
    if (mediaCache[mediaId]) return mediaCache[mediaId];

    try {
      const { data } = await get(`/upload/files/${mediaId}`);
      const url = data.url;
      setMediaCache((prev) => ({ ...prev, [mediaId]: url }));
      return url;
    } catch (err) {
      console.error('Failed to fetch media:', err);
      return null;
    }
  };

  // Fetch all media URLs when modal opens
  useEffect(() => {
    if (!showModal || !selectedRequest) return;

    const requestedChanges = selectedRequest?.attributes?.requested_changes || selectedRequest?.requested_changes || {};
    const mediaIds = Object.entries(requestedChanges)
      .filter(([field]) => MEDIA_FIELDS.includes(field))
      .map(([, value]) => (typeof value === 'number' ? value : null))
      .filter((id) => id !== null);

    mediaIds.forEach((mediaId) => {
      if (!mediaCache[mediaId]) {
        fetchMediaUrl(mediaId);
      }
    });
  }, [showModal, selectedRequest]);

  // Prefetch photo URLs for visible requests so Excel export shows links instead of only media IDs.
  useEffect(() => {
    const pendingIds = new Set();

    list.forEach((entry) => {
      const requestedChanges = entry?.attributes?.requested_changes || entry?.requested_changes || {};
      const mediaId = requestedChanges?.photograph;
      if (typeof mediaId === 'number' && !mediaCache[mediaId]) {
        pendingIds.add(mediaId);
      }
    });

    pendingIds.forEach((mediaId) => {
      fetchMediaUrl(mediaId);
    });
  }, [list]);

  const renderChangesPreview = (requestedChanges) => {
    if (!requestedChanges || typeof requestedChanges !== 'object') {
      return <Typography>No changes specified</Typography>;
    }

    const attrs = selectedRequest?.attributes || selectedRequest || {};
    const previousValues = attrs.previous_values || selectedRequest?.previous_values || {};

    // Get old values from selectedRequest's user (if available)
    // Support both Strapi v4 (with .data/.attributes) and flat populated object
    let user = {};
    if (selectedRequest?.attributes?.users_permissions_user?.data?.attributes) {
      user = selectedRequest.attributes.users_permissions_user.data.attributes;
    } else if (selectedRequest?.users_permissions_user?.attributes) {
      user = selectedRequest.users_permissions_user.attributes;
    } else if (selectedRequest?.users_permissions_user) {
      user = selectedRequest.users_permissions_user;
    }
    // Helper to get old value with fallback for common aliases
    const getOldValue = (field) => {
      if (previousValues && Object.prototype.hasOwnProperty.call(previousValues, field)) {
        return previousValues[field];
      }
      if (field === 'username' && attrs.requester_name) {
        return attrs.requester_name;
      }
      if (user[field] !== undefined) return user[field];
      if (field === 'name' && user.employee_name !== undefined) return user.employee_name;
      if (field === 'employee_name' && user.name !== undefined) return user.name;
      if (field === 'ext' && user.extension !== undefined) return user.extension;
      if (field === 'branch' && user.branch !== undefined) return user.branch;
      return undefined;
    };

    const renderValue = (field, value) => {
      // Handle media fields (photograph)
      if (MEDIA_FIELDS.includes(field)) {
        if (typeof value === 'number') {
          // It's a media ID - get the URL from cache
          const mediaUrl = mediaCache[value];

          if (mediaUrl) {
            return (
              <Box>
                <img
                  src={mediaUrl}
                  alt={field}
                  style={{ maxWidth: 200, maxHeight: 200, marginLeft: 8, borderRadius: 4, display: 'block', marginBottom: 8 }}
                />
                <a
                  href={mediaUrl}
                  download
                  style={{
                    marginLeft: 8,
                    padding: '4px 12px',
                    background: '#4945ff',
                    color: '#fff',
                    borderRadius: 4,
                    textDecoration: 'none',
                    fontSize: 13,
                    display: 'inline-block',
                    cursor: 'pointer',
                  }}
                >
                  Download Photo
                </a>
              </Box>
            );
          }
          return <Typography variant="omega" style={{ marginLeft: 8 }}>Loading media...</Typography>;
        }
        // If it's an object with url property
        if (typeof value === 'object' && value?.url) {
          return (
            <Box>
              <img
                src={value.url}
                alt={field}
                style={{ maxWidth: 200, maxHeight: 200, marginLeft: 8, borderRadius: 4, display: 'block', marginBottom: 8 }}
              />
              <a
                href={value.url}
                download
                style={{
                  marginLeft: 8,
                  padding: '4px 12px',
                  background: '#4945ff',
                  color: '#fff',
                  borderRadius: 4,
                  textDecoration: 'none',
                  fontSize: 13,
                  display: 'inline-block',
                  cursor: 'pointer',
                }}
              >
                Download Photo
              </a>
            </Box>
          );
        }
      }

      // Default rendering for non-media fields
      return (
        <Typography variant="omega">
          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
        </Typography>
      );
    };

    return (
      <Box>
        {Object.entries(requestedChanges).map(([field, newValue]) => {
          const oldValue = getOldValue(field);
          return (
            <Flex key={field} padding={2} background="neutral100" marginBottom={2} hasRadius style={{ alignItems: 'flex-start' }}>
              <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <Typography variant="pi" fontWeight="bold" style={{ minWidth: 80, marginBottom: 8 }}>
                  {field}:
                </Typography>
                {oldValue !== undefined && (
                  <Box marginBottom={2}>
                    <Typography variant="omega" style={{ textDecoration: 'line-through', color: '#666' }}>
                      Old: {typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue)}
                    </Typography>
                  </Box>
                )}
                <Box>
                  <Typography variant="omega" style={{ marginRight: 8, display: 'inline' }}>
                    {oldValue !== undefined ? 'New:' : 'Value:'}
                  </Typography>
                  {renderValue(field, newValue)}
                </Box>
              </Box>
            </Flex>
          );
        })}
      </Box>
    );
  };

  const getRejectionReasonValue = (entry) => {
    const attrs = entry?.attributes || entry || {};
    return normalizeRejectionReason(attrs.reason_for_rejection || '');
  };

  const getRejectionReasonDisplay = (entry) => getRejectionReasonValue(entry) || '\u2014';

  const rejectionReasonColumnWidth = useMemo(() => {
    if (!shouldShowRejectionReasonColumn) {
      return REJECTION_REASON_COLUMN_MIN_WIDTH;
    }

    const headerLength = 'Rejection Reason'.length;
    const maxReasonLength = filteredList.reduce((maxLen, entry) => {
      const reason = getRejectionReasonValue(entry);
      return Math.max(maxLen, reason.length);
    }, 0);

    const effectiveLength = Math.max(headerLength, maxReasonLength);
    const estimatedWidth = Math.ceil(effectiveLength * 8 + 30);

    return Math.min(
      REJECTION_REASON_COLUMN_MAX_WIDTH,
      Math.max(REJECTION_REASON_COLUMN_MIN_WIDTH, estimatedWidth)
    );
  }, [filteredList, shouldShowRejectionReasonColumn]);

  return (
    <Layouts.Root>
      <Layouts.Header
        title="Profile Edit Requests"
        subtitle={
          loading
            ? 'Loading…'
            : `${list.length} request${list.length === 1 ? '' : 's'}`
        }
      />
      <Layouts.Content>
        {/* Unified filter card */}
        <Box
          padding={4}
          background="neutral0"
          hasRadius
          shadow="tableShadow"
          marginBottom={6}
        >
          <Typography variant="sigma" textColor="neutral600" marginBottom={3}>
            Filters
          </Typography>
          <Flex gap={4} wrap="wrap" alignItems="flex-end">
             <Box style={{ minWidth: 160 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                Company
              </Typography>
              <SingleSelect
                value={companyFilter}
                onChange={(v) => {
                  setCompanyFilter(String(v || ''));
                  setLocationFilter('');
                  setPage(1);
                }}
              >
                {COMPANY_OPTIONS.map((opt) => (
                  <SingleSelectOption key={opt.value || 'all'} value={opt.value}>
                    {opt.label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Box>
            <Box style={{ minWidth: 200 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                Location
              </Typography>
              <SingleSelect
                value={locationFilter}
                onChange={(v) => {
                  setLocationFilter(String(v || ''));
                  setPage(1);
                }}
              >
                <SingleSelectOption value="">All Locations</SingleSelectOption>
                {locationOptions.map((loc) => (
                  <SingleSelectOption key={loc} value={loc}>
                    {loc}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Box>
            <Box style={{ minWidth: 220 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                Search
              </Typography>
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={companyFilter.toLowerCase() === 'aia' ? 'Employee code (digits)' : companyFilter.toLowerCase() === 'vega' ? 'EMP ID (EMP12345)' : 'User, company, ID, etc.'}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #dcdce4',
                  borderRadius: '4px',
                  fontSize: '14px',
                  width: '100%',
                }}
              />
            </Box>
            <Box style={{ minWidth: 180 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                Status
              </Typography>
              <SingleSelect
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter(String(v || ''));
                  setPage(1);
                }}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <SingleSelectOption key={opt.value || 'all'} value={opt.value}>
                    {opt.label}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Box>
            <Box style={{ minWidth: 260 }}>
              <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4, display: 'block' }}>
                Date Range
              </Typography>
              <DateRangeInput
                value={dateRange}
                onChange={({ start, end }) => {
                  setDateRange({ start, end });
                  setPage(1);
                }}
              />
            </Box>
          </Flex>
        </Box>

        {loading ? (
          <Flex justifyContent="center" padding={8}>
            <Loader>Loading...</Loader>
          </Flex>
        ) : list.length === 0 ? (
          <Box padding={6} background="neutral100" hasRadius>
            <Typography textColor="neutral600">No profile edit requests yet.</Typography>
          </Box>
        ) : totalFiltered === 0 ? (
          <Box padding={6} background="neutral100" hasRadius>
            <Typography textColor="neutral600">No requests match your search or filter.</Typography>
          </Box>
        ) : (
          <>
            {/* <Box background="neutral0" hasRadius shadow="tableShadow" padding={6}> */}
              <DataTable
                title="Profile Edit Requests"
                data={pageList}
                fullData={filteredList}
                paginatedData={pageList}
                        columns={[
                          {
                            key: 'userName',
                            label: 'Employee',
                            exportValue: (val, row) => getDisplayValues(row).userName,
                          },
                          { key: 'userId', label: 'User ID', exportValue: (val, row) => getEmployeeIdentifier(row), render: (val, row) => {
                              return <Typography variant="omega" style={TABLE_FONT_STYLE}>{getEmployeeIdentifier(row)}</Typography>;
                            }
                          },
                          {
                            key: 'request_status',
                            label: 'Status',
                            exportValue: (val, row) => getStatusValue(row),
                            render: (val, row) => {
                              const status = getStatusValue(row);
                              const tone = status === 'Approved' ? 'success' : status === 'Rejected' ? 'danger' : 'secondary';
                              const pendingTooltip = status === 'Pending'
                                ? getPendingCommentsTooltipText(row)
                                : '';

                              if (!pendingTooltip) {
                                return <Badge tone={tone}>{status}</Badge>;
                              }

                              return (
                                <span
                                  title={pendingTooltip}
                                  style={{ cursor: 'help', display: 'inline-flex' }}
                                >
                                  <Badge tone={tone}>{status}</Badge>
                                </span>
                              );
                            },
                          },
                          {
                            key: 'changes',
                            label: 'Changes',
                            exportValue: (val, row) => getChangesExportText(row),
                            render: (val, row) => (
                              <Button size="S" variant="tertiary" onClick={() => viewChanges(row)}>
                                View
                              </Button>
                            ),
                          },
                          {
                            key: 'company',
                            label: 'Company',
                            exportValue: (val, row) => getDisplayValues(row).userCompany || '—',
                            header: (
                              <Box
                                style={{
                                  width: `${COMPANY_COLUMN_WIDTH}px`,
                                  minWidth: `${COMPANY_COLUMN_WIDTH}px`,
                                  maxWidth: `${COMPANY_COLUMN_WIDTH}px`,
                                }}
                              >
                                <Typography variant="sigma" textColor="neutral600">
                                  Company
                                </Typography>
                              </Box>
                            ),
                            render: (val, row) => (
                              <Box
                                style={{
                                  width: `${COMPANY_COLUMN_WIDTH}px`,
                                  minWidth: `${COMPANY_COLUMN_WIDTH}px`,
                                  maxWidth: `${COMPANY_COLUMN_WIDTH}px`,
                                }}
                              >
                                <Typography variant="omega" style={TABLE_FONT_STYLE}>
                                  {row?.userCompany || '\u2014'}
                                </Typography>
                              </Box>
                            ),
                          },
                          {
                            key: 'user_location',
                            label: 'Location',
                            exportValue: (val, row) => getUserLocationValue(row),
                            render: (val, row) => (
                              <Typography variant="omega" style={TABLE_FONT_STYLE}>
                                {getUserLocationValue(row)}
                              </Typography>
                            ),
                          },
                          ...(shouldShowRejectionReasonColumn
                            ? [
                                {
                                  key: 'reason_for_rejection',
                                  label: 'Rejection Reason',
                                  thStyle: {
                                    width: `${rejectionReasonColumnWidth}px`,
                                    minWidth: `${rejectionReasonColumnWidth}px`,
                                    maxWidth: `${rejectionReasonColumnWidth}px`,
                                    overflow: 'hidden',
                                  },
                                  tdStyle: {
                                    width: `${rejectionReasonColumnWidth}px`,
                                    minWidth: `${rejectionReasonColumnWidth}px`,
                                    maxWidth: `${rejectionReasonColumnWidth}px`,
                                    overflow: 'hidden',
                                  },
                                  header: (
                                    <Box
                                      style={{
                                        width: `${rejectionReasonColumnWidth}px`,
                                        minWidth: `${rejectionReasonColumnWidth}px`,
                                        maxWidth: `${rejectionReasonColumnWidth}px`,
                                      }}
                                    >
                                      <Typography variant="sigma" textColor="neutral600">
                                        Rejection Reason
                                      </Typography>
                                    </Box>
                                  ),
                                  exportValue: (val, row) => getRejectionReasonDisplay(row),
                                  render: (val, row) => {
                                    const reason = getRejectionReasonDisplay(row);
                                    return (
                                      <Box
                                        title={reason === '\u2014' ? undefined : reason}
                                        style={{
                                          width: `${rejectionReasonColumnWidth}px`,
                                          minWidth: `${rejectionReasonColumnWidth}px`,
                                          maxWidth: `${rejectionReasonColumnWidth}px`,
                                          overflow: 'hidden',
                                          display: '-webkit-box',
                                          WebkitLineClamp: 2,
                                          WebkitBoxOrient: 'vertical',
                                          whiteSpace: 'normal',
                                          textOverflow: 'ellipsis',
                                        }}
                                      >
                                        <Typography variant="omega" style={TABLE_FONT_STYLE}>
                                          {reason}
                                        </Typography>
                                      </Box>
                                    );
                                  },
                                },
                              ]
                            : []),
                        ]}
                pagination={{
                  page: currentPage,
                  pageSize: pageSize,
                  total: totalFiltered,
                  onPageChange: (p) => setPage(Number(p)),
                  onPageSizeChange: (newSize) => {
                    setPageSize(Number(newSize));
                    setPage(1);
                  },
                }}
                exportFileName={`profile-edit-requests-${new Date().toISOString().split('T')[0]}.xlsx`}
                fontSize={TABLE_FONT_STYLE.fontSize}
              />

              {/* Pagination removed as requested */}
            {/* </Box> */}
          </>
        )}

        {/* Changes Preview Modal */}
        {showModal && selectedRequest && (
          <Modal.Root open={showModal} onOpenChange={(open) => !open && setShowModal(false)}>
            <Modal.Content>
              <Modal.Header>
                <Modal.Title>Requested Profile Changes</Modal.Title>
              </Modal.Header>
              <Modal.Body>
                <Box padding={4}>
                  <Typography variant="omega" fontWeight="bold" marginBottom={4}>
                    Employee: {getDisplayValues(selectedRequest).userName}
                  </Typography>
                  {renderChangesPreview(getDisplayValues(selectedRequest).requestedChanges)}
                  {getStatusValue(selectedRequest) === 'Rejected' && (
                    <Box marginTop={4}>
                      <Typography variant="omega">
                        <Typography as="span" variant="omega" fontWeight="bold">
                          Rejection Reason:{' '}
                        </Typography>
                        {getRejectionReasonValue(selectedRequest) || 'No rejection reason recorded.'}
                      </Typography>
                    </Box>
                  )}
                  {getStatusValue(selectedRequest) === 'Pending' && getPendingComments(selectedRequest).length > 0 && (
                    <Box marginTop={4}>
                      <Typography variant="pi" fontWeight="bold" marginBottom={2}>
                        Pending Notes Sent to User
                      </Typography>
                      {getPendingComments(selectedRequest).map((item, index) => (
                        <Box
                          key={`${item.commented_at || index}-${index}`}
                          padding={3}
                          background="neutral100"
                          hasRadius
                          marginBottom={2}
                        >
                          <Typography variant="omega">{item.comment}</Typography>
                          <Typography variant="pi" textColor="neutral600" marginTop={1}>
                            {item.commented_by?.name || 'Admin'}
                            {item.commented_at ? ` • ${new Date(item.commented_at).toLocaleString()}` : ''}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                  {getStatusValue(selectedRequest) === 'Pending' && (
                    <Box marginTop={4}>
                      <Typography variant="pi" fontWeight="bold" marginBottom={2}>
                        Send Pending Note to User
                      </Typography>
                      <textarea
                        value={pendingComment}
                        onChange={(event) => {
                          setPendingComment(event.target.value);
                          if (pendingCommentError) {
                            setPendingCommentError('');
                          }
                        }}
                        rows={3}
                        placeholder="Explain why this request is still pending"
                        style={{
                          width: '100%',
                          border: '1px solid #dcdce4',
                          borderRadius: '4px',
                          padding: '8px 12px',
                          fontSize: '14px',
                          resize: 'vertical',
                        }}
                      />
                      {pendingCommentError ? (
                        <Typography variant="pi" textColor="danger600" marginTop={2}>
                          {pendingCommentError}
                        </Typography>
                      ) : null}
                      <Box marginTop={2}>
                        <Button
                          variant="secondary"
                          disabled={updatingId === String(entryId(selectedRequest))}
                          onClick={handleSendPendingComment}
                        >
                          Send Comment
                        </Button>
                      </Box>
                    </Box>
                  )}
                  {getStatusValue(selectedRequest) === 'Pending' && showRejectReasonInput && (
                    <Box marginTop={4}>
                      <Typography variant="pi" fontWeight="bold" marginBottom={2}>
                        Reason for Rejection
                      </Typography>
                      <textarea
                        value={rejectionReason}
                        onChange={(event) => {
                          setRejectionReason(event.target.value);
                          if (rejectionReasonError) {
                            setRejectionReasonError('');
                          }
                        }}
                        rows={4}
                        placeholder="Enter the reason that will be sent to the requester"
                        style={{
                          width: '100%',
                          border: '1px solid #dcdce4',
                          borderRadius: '4px',
                          padding: '8px 12px',
                          fontSize: '14px',
                          resize: 'vertical',
                        }}
                      />
                      {rejectionReasonError ? (
                        <Typography variant="pi" textColor="danger600" marginTop={2}>
                          {rejectionReasonError}
                        </Typography>
                      ) : null}
                    </Box>
                  )}
                </Box>
              </Modal.Body>
              <Modal.Footer>
                {getStatusValue(selectedRequest) === 'Pending' && (
                  <>
                    {showRejectReasonInput ? (
                      <>
                        <Button
                          variant="danger"
                          disabled={updatingId === String(entryId(selectedRequest))}
                          onClick={handleConfirmReject}
                        >
                          Confirm Reject
                        </Button>
                        <Button
                          variant="tertiary"
                          disabled={updatingId === String(entryId(selectedRequest))}
                          onClick={handleCancelReject}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="danger"
                          disabled={updatingId === String(entryId(selectedRequest))}
                          onClick={handleStartReject}
                        >
                          Reject
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={updatingId === String(entryId(selectedRequest))}
                          onClick={handleApprove}
                        >
                          Approve
                        </Button>
                      </>
                    )}
                  </>
                )}
                <Button variant="tertiary" onClick={() => setShowModal(false)}>
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Content>
          </Modal.Root>
        )}
      </Layouts.Content>
    </Layouts.Root>
  );
}