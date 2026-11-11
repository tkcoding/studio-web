# Todo App: what we want

Our team keeps losing track of small jobs, so we want a simple web app for personal tasks. It is
for one person at a time, not for teams. Below is what we agreed with design last week.

## The basics

People should be able to add a task by typing a title, and if they want they can also add a longer
description, a due date, a priority and a category. A task they have finished can be ticked off, and
if they tick it by mistake they can untick it and it goes back to being open.

Deleting a task has to really remove it, there is no bin or undo.

## Keeping devices in step

Most of us use a phone and a laptop. Whatever changes on one device should show up on the others
straight away, through a feed of changes that every connected device listens to.

## Finding things

The list needs a filter. We want to narrow it by whether tasks are open, done or both, and also by
category and by priority.

## How it should behave

It has to feel instant: every tap or click should finish within 200 milliseconds for 95 out of 100
people on a normal day.

Nothing may be lost if the connection drops. Changes are written on the device at once, and as soon
as there is a connection they are copied to the cloud, which should take no more than 5 seconds.

Working with no network at all matters too. Adding, ticking off, filtering and deleting tasks all
have to keep working offline.

## Not now

Sharing a list with other people is out of scope for the first release. We would like 95% of new
users to get through onboarding, and a score above 40 on the NPS survey, but those are goals, not
features.
