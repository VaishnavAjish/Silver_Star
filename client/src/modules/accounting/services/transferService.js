import api from '@shared/services/api';

export const getTransfers = (params) => {
  const q = new URLSearchParams(params).toString();
  return api(`/transfers?${q}`);
};

export const getTransfer = (id) => {
  return api(`/transfers/${id}`);
};

export const createTransfer = (data) => {
  return api('/transfers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
};

export const reverseTransfer = (id) => {
  return api(`/transfers/${id}`, {
    method: 'DELETE',
  });
};
