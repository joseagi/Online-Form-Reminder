import { countNotificationProblems, PROBLEM_WINDOW_DAYS } from '@/lib/admin/data';

// A red count of messages that failed or were not delivered recently. For administrators only:
// render it only after the admin check. Shows nothing when all is well, or if it can't be counted.
export async function ProblemBadge() {
  let count: number;
  try {
    count = await countNotificationProblems();
  } catch (error) {
    console.error(error);
    return null;
  }
  if (count === 0) return null;
  return (
    <span data-testid="problem-badge" className="ml-1.5 inline-block rounded-full bg-red-600 px-1.5 text-xs font-medium leading-5 text-white">
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">
        {`: ${count} ${count === 1 ? 'message' : 'messages'} failed or not delivered in the last ${PROBLEM_WINDOW_DAYS} days`}
      </span>
    </span>
  );
}
