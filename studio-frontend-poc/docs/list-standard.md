# How a list behaves

Every list or table in the prototype follows these rules: projects, specs,
artifacts, sources, people, connections, components, runs, and the rest. A
person who learned one tab already knows the others. Each rule is here
because the audit of 2026-09-30 found at least one screen breaking it.

They are built in, not asked of each screen. A list is a `DataTable`
(`src/data-table.tsx`), and a screen describes only what is its own: the
columns, where the rows come from, the filters it offers and the actions a
row has.

## Where things are

- **One toolbar, above the list:**
  - on the left, search, then the filters;
  - on the right, the view toggle (when the list has tiles) and the list's
    primary action.
- **The search box belongs to the list.** The shell's side-panel query is not
  a list's search, and no list reads it.
- **The heading counts what is shown**: "12 of 40" when a filter or a search
  hides some rows, "40" when nothing is hidden.

## What a click does

- **Clicking a row opens it**, and so do Enter and Space on a focused row. If
  a row has nothing to open, it is not clickable and does not look clickable.
- **Controls inside a row do their own thing.** A button, link, select or input
  never opens the row as a side effect.
- **A row with details to show expands** through its ▸ toggle only. Clicking
  the rest of the row still opens the row.

## Row actions

- **A row's actions are in its "…" menu, always in this order:** Open first,
  the other actions next, the destructive ones last and marked as danger.
  - A single primary action the row exists for (Sync, Confirm) may also stand
    as an inline button beside the menu.
- **The menu closes** on Escape, on a click outside it, and after an item is
  chosen. It does not close because the pointer left it.
- **Every destructive action asks first**, through one confirm dialog: it names
  the thing, says what happens, and gives a danger-styled button. That covers
  delete, remove, detach, revoke and cancel. `window.confirm` is not used.

## Sorting, filtering, paging

- **Sortable columns sort from their header.** The first click sorts ascending,
  the second descending. The header carries `aria-sort`, and one column sorts
  at a time. A list may also have a default order it shows before any header
  is clicked.
- **Filters are chips with counts** when there are a few values, and a select
  when there are many. Each chip counts the rows its value would show under
  the other filters and the search. A count that cannot be known reads "—",
  never 0.
- **Paging:** a list longer than a page shows the shared pager under it, at its
  right edge, with "51–100 of 2,446" first and then the pages. A list is never cut short without saying so. When the
  backend pages, the table asks it for the page. When the list arrived whole,
  the table pages it in the browser. Both look the same.
- **Rows per page is the reader's choice:** 25, 50, 100 or 200, picked at the
  pager's left, 50 until somebody picks. The pager keeps that control even on a
  single page while a smaller size would make more than one.
- **A new search, filter or page size goes back to page one.**

## The address

- **Search, filters, sort and page are in the URL**, as `?q=`, `?f.<name>=`,
  `?sort=<column>` or `?sort=-<column>` for descending, and `?page=` counted
  from 1. They are replaced, not pushed, so Back still goes to the previous
  place.
  - A reload, a shared link or a return through Back restores the list as it
    was.
  - Opening another place starts that place's list fresh.
- **Table or tiles, and rows per page, are preferences, not an address**, so
  they stay with the person (`useViewMode`, `usePageSize`). A shared link opens
  at the reader's own size.

## Time, and not knowing

- **Times are relative** ("5 days ago"), with the full timestamp in the tooltip,
  everywhere, through `When`.
- **"—" means unknown.** It never means zero, and zero is never written as "—".

## Empty, loading, failed

These four states never show at the same time.

- **Loading** says so. It is not "nothing here".
- **Failed** shows the error and a Retry. It does not also show the empty
  text.
- **Nothing exists** says what would put something there, with the action
  that does it when there is one.
- **Nothing matches** says so, with **Clear filters**.
