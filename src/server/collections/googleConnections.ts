import { defineCollection } from '@nocobase/database';

export default defineCollection({
  name: 'googleConnections',
  title: 'Google Connections',
  autoGenId: true,
  timestamps: true,
  fields: [
    { type: 'belongsTo', name: 'user', target: 'users', foreignKey: 'userId', onDelete: 'CASCADE' },
    { type: 'bigInt', name: 'userId', unique: true, allowNull: false, index: true },
    { type: 'string', name: 'googleEmail', allowNull: true },
    { type: 'string', name: 'googleSub', allowNull: true, index: true, comment: 'Google account subject id' },
    { type: 'text', name: 'accessToken', allowNull: false },
    { type: 'encryption', name: 'refreshToken', allowNull: false, comment: 'Long-lived refresh token, encrypted at rest' },
    { type: 'date', name: 'expiresAt', allowNull: false, comment: 'Access-token expiry (UTC)' },
    { type: 'string', name: 'scope', allowNull: true, comment: 'Space-separated OAuth scopes granted' },
    { type: 'string', name: 'tokenType', defaultValue: 'Bearer' },
    { type: 'string', name: 'status', defaultValue: 'active', comment: 'active | revoked | error' },
    { type: 'text', name: 'lastError', allowNull: true },
  ],
});