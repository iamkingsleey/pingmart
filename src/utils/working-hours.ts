/**
 * Working Hours Utility
 *
 * Determines whether the vendor's store is currently open based on their
 * configured working hours and timezone.
 *
 * All time comparisons use the vendor's local timezone (default: Africa/Lagos)
 * to correctly handle Nigerian time regardless of server location.
 */
import { Vendor } from '@prisma/client';

export interface StoreStatus {
  isOpen: boolean;
  opensAt?: string;   // e.g. "8:00 AM" — shown to customer when closed
  closesAt?: string;  // e.g. "9:00 PM" — shown to customer when open
  message: string;    // human-readable status message
}

export function getStoreStatus(vendor: Vendor): StoreStatus {
  // If vendor accepts orders anytime, always return open
  if (vendor.acceptOffHoursOrders) {
    return { isOpen: true, message: 'Store is open 24/7' };
  }

  const timezone = vendor.timezone ?? 'Africa/Lagos';
  const now = new Date();

  // Get current time components in vendor's timezone
  const localParts = new Intl.DateTimeFormat('en-NG', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const currentHour = parseInt(localParts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const currentMinute = parseInt(localParts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const currentDay = localParts.find(p => p.type === 'weekday')?.value; // Mon, Tue …

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const currentDayNumber = dayMap[currentDay ?? 'Mon'] ?? 1;

  // Check if today is a working day
  const workingDays = (vendor.workingDays ?? '1,2,3,4,5,6')
    .split(',')
    .map(d => parseInt(d.trim(), 10));

  const [startHour, startMin] = (vendor.workingHoursStart ?? '08:00').split(':').map(Number);
  const [endHour, endMin] = (vendor.workingHoursEnd ?? '21:00').split(':').map(Number);

  const formatTime = (h: number, m: number): string => {
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${period}`;
  };

  if (!workingDays.includes(currentDayNumber)) {
    return {
      isOpen: false,
      opensAt: formatTime(startHour, startMin),
      message: 'Closed today',
    };
  }

  const currentMinutes = currentHour * 60 + currentMinute;
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  const isOpen = currentMinutes >= startMinutes && currentMinutes < endMinutes;

  return {
    isOpen,
    opensAt: formatTime(startHour, startMin),
    closesAt: formatTime(endHour, endMin),
    message: isOpen ? 'Store is open' : 'Store is closed',
  };
}
