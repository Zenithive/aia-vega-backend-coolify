import React, { useEffect, useState } from 'react';
import { Box, Typography, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import { useAnalytics } from '../hooks/useAnalytics';

export function EmployeeSelector({ value, onChange, company, department }) {
  const { fetchEmployees } = useAnalytics();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = {};
    if (company) params.company = company;
    if (department) params.department = department;
    fetchEmployees(params)
      .then(setEmployees)
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false));
  }, [company, department]);

  return (
    <Box style={{ minWidth: 220 }}>
      <Typography variant="pi" textColor="neutral600" style={{ marginBottom: 4 }}>
        Employee
      </Typography>
      <SingleSelect
        value={value ? String(value) : ''}
        onChange={(v) => onChange(v ? Number(v) : null)}
        placeholder={loading ? 'Loading...' : ''}
        disabled={loading}
      >
        <SingleSelectOption value="">Select employee</SingleSelectOption>
        {employees.map((emp) => (
          <SingleSelectOption key={emp.id} value={String(emp.id)}>
            {emp.username || emp.email || `User ${emp.id}`}
          </SingleSelectOption>
        ))}
      </SingleSelect>
    </Box>
  );
}
