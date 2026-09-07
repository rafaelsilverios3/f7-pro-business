import { createRepository } from '@/data/repositoryFactory';
import { calculateChannelScore } from '@/lib/channelScoring';
const channels = createRepository('SalesChannel'); const links = createRepository('ProductChannel'); const metrics = createRepository('ChannelMetric');
export const salesHubService = { listChannels: (companyId) => channels.list(companyId, 'name'), listLinks: (companyId) => links.list(companyId), listMetrics: (companyId) => metrics.list(companyId, '-created_date'), addChannel: (companyId, data) => channels.create({ ...data, connected: false, status: 'disconnected' }, companyId), linkProduct: (companyId, data) => links.create(data, companyId), addMetric: (companyId, data) => metrics.create(data, companyId), channelScore: calculateChannelScore };
