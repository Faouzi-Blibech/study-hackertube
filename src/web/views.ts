import type { CourseIdentity } from '../core/types';

export type View = 'grid' | 'galaxy';

/** "Looks like: Area > Category (82%)" above the results; null when the course is unknown. */
export function buildCourseLine(course: CourseIdentity | null): HTMLElement | null {
  if (!course) return null;
  const top = course.categories[0];
  const p = document.createElement('p');
  p.className = 'course-line';
  p.append('Looks like: ');
  const path = document.createElement('strong');
  path.textContent = top ? `${course.area.name} > ${top.name}` : course.area.name;
  p.append(path, ` (${Math.round((top ?? course.area).confidence * 100)}%)`);
  const more = course.categories.slice(1).map((c) => c.name);
  if (more.length > 0) {
    const also = document.createElement('span');
    also.className = 'course-also';
    also.textContent = ` Also close to ${more.join(', ')}.`;
    p.append(also);
  }
  return p;
}

/** Grid | Galaxy switch: two real buttons with aria-pressed, reachable and operable from the keyboard. */
export function buildViewToggle(current: View, onChange: (v: View) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'view-toggle';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Results view');
  for (const [view, label] of [['grid', 'Grid'], ['galaxy', 'Galaxy']] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset['view'] = view;
    b.setAttribute('aria-pressed', String(view === current));
    b.addEventListener('click', () => {
      for (const o of group.querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
      onChange(view);
    });
    group.append(b);
  }
  return group;
}
