import React, { useState } from 'react';
import { Box, Typography, Button, Flex } from '@strapi/design-system';
import { useAnalytics } from '../hooks/useAnalytics';


export function EmployeeSearch({ value, onChange, onEmployeeFound, company }) {
  const { fetchEmployees } = useAnalytics();
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [foundEmployee, setFoundEmployee] = useState(null);

  const handleSearch = async () => {
    const q = searchInput?.trim();
    if (!q) {
      onChange(null);
      setFoundEmployee(null);
      setNotFound(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    setFoundEmployee(null);
    try {
      const res = await fetchEmployees({ search: q, includeInactiveBlocked: true, ...(company ? { company } : {}) });
      const employees = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
      let found = null;
      if (employees.length > 0) {
        const qLower = q.toLowerCase();
        const isAIA = company && company.toLowerCase() === 'aia';
        const isVega = company && company.toLowerCase() === 'vega';
        // If API returned exactly one user for a search, use it (backend already filtered)
        if (employees.length === 1) {
          found = employees[0];
        } else {
          found = employees.find(emp => {
            const name = (emp.username || emp.email || '').toLowerCase();
            const empCode = String(emp.emp_code ?? '').toLowerCase();
            const empId = String(emp.emp_id ?? '').toLowerCase();
            const idStr = String(emp.id ?? '').toLowerCase();
            const email = (emp.email || '').toLowerCase();
            if (isAIA && /^\d+$/.test(qLower)) {
              return idStr === qLower || empCode.includes(qLower);
            }
            if (isVega && /^emp\d+$/i.test(q)) {
              return idStr === qLower || empId.includes(qLower);
            }
            return (
              name.includes(qLower) ||
              empCode.includes(qLower) ||
              empId.includes(qLower) ||
              idStr === qLower ||
              email.includes(qLower)
            );
          });
        }
      }
      if (found) {
        setFoundEmployee(found);
        onChange(found.id);
        onEmployeeFound?.(found);
        setNotFound(false);
      } else {
        setFoundEmployee(null);
        onChange(null);
        onEmployeeFound?.(null);
        setNotFound(true);
      }
    } catch {
      setFoundEmployee(null);
      onChange(null);
      onEmployeeFound?.(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSearchInput('');
    setFoundEmployee(null);
    setNotFound(false);
    onChange(null);
    onEmployeeFound?.(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  // Dynamic placeholder based on company
  let placeholder = 'Search Employee';
  if (company && company.toLowerCase() === 'aia') {
    placeholder = 'Search AIA Employee';
  } else if (company && company.toLowerCase() === 'vega') {
    placeholder = 'Search VEGA Employee';
  }

  return (
    <Box style={{ minWidth: 260 }}>
      <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
       Search Employee
       
      </Typography>
      <Flex gap={2} alignItems="stretch">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={loading}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #dcdce4',
            borderRadius: '4px',
            fontSize: '14px',
          }}
        />
        <Button onClick={handleSearch} loading={loading} size="S">
          Search
        </Button>
        {(value || foundEmployee) && (
          <Button onClick={handleClear} variant="tertiary" size="S">
            Clear
          </Button>
        )}
      </Flex>
      {notFound && (
        <Typography variant="pi" textColor="danger600" style={{ marginTop: 4 }}>
          Employee not found
        </Typography>
      )}
    </Box>
  );
}
