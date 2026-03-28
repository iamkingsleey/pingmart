/**
 * Off-hours contact repository — tracks customers who messaged while the
 * store was closed. Used by the opening-notification job.
 */
import { prisma } from './prisma';

export const offHoursContactRepository = {
  /** Record (or de-duplicate) a customer's off-hours contact for a vendor. */
  async record(customerPhone: string, vendorId: string): Promise<void> {
    // One record per customer per vendor per calendar day is enough
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existing = await prisma.offHoursContact.findFirst({
      where: {
        vendorId,
        customerPhone,
        contactedAt: { gte: today },
      },
    });
    if (!existing) {
      await prisma.offHoursContact.create({ data: { vendorId, customerPhone } });
    }
  },

  /** Returns all un-notified contacts for a vendor from the last 24 hours. */
  async findPendingForVendor(vendorId: string): Promise<{ id: string; customerPhone: string }[]> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return prisma.offHoursContact.findMany({
      where: { vendorId, notifiedOpen: false, contactedAt: { gte: since } },
      select: { id: true, customerPhone: true },
    });
  },

  /** Mark contacts as notified after sending the "we're open" message. */
  async markNotified(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await prisma.offHoursContact.updateMany({
      where: { id: { in: ids } },
      data: { notifiedOpen: true },
    });
  },
};
