import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { briefRequirementOf, type Operation } from '../../media/operations/descriptor';
import { GROUP_LABELS, groupOperations } from '../../media/operations/registry';

/**
 * The list of jobs, as the way into the app. Choosing here is what decides
 * which files the next screen asks for (D26), so this is the first thing on the
 * home screen rather than a menu hidden behind a file.
 */
@Component({
  selector: 'app-operation-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (searchable()) {
      <div class="relative" role="search">
        <svg
          class="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.25" stroke="currentColor" stroke-width="1.5" />
          <path
            d="m10.5 10.5 3 3"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
        <input
          type="search"
          class="w-full rounded-card border border-line bg-surface py-3 pl-10 pr-3 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none"
          placeholder="Search — compress, audio, rotate…"
          aria-label="Search the jobs"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
        />
      </div>
    }

    @for (group of groups(); track group.group) {
      <section class="mt-6">
        <h2 class="text-xs font-medium uppercase tracking-wide text-faint">{{ group.label }}</h2>
        <div class="mt-3 grid gap-2 sm:grid-cols-2">
          @for (operation of group.operations; track operation.id) {
            <a
              [routerLink]="['/', operation.route]"
              class="group rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent hover:bg-accent-soft focus-visible:border-accent focus-visible:outline-none"
            >
              <span class="flex items-baseline justify-between gap-2">
                <span class="text-sm font-medium text-ink">{{ operation.title }}</span>
                @if (brief(operation); as chip) {
                  <span
                    class="shrink-0 rounded-full border border-line bg-raised px-2 py-0.5 text-xs text-muted"
                    >{{ chip }}</span
                  >
                }
              </span>
              <span class="mt-1 block text-xs leading-relaxed text-muted">{{
                operation.summary
              }}</span>
            </a>
          }
        </div>
      </section>
    }

    @if (groups().length === 0) {
      <p class="mt-6 rounded-card border border-line bg-surface p-5 text-sm text-muted">
        Nothing matches “{{ query() }}”. Cinch does {{ operations().length }} jobs in all — clear
        the search to see them.
      </p>
    }
  `,
})
export class OperationPicker {
  readonly operations = input.required<readonly Operation[]>();
  /** The full catalogue wants a search box; a short filtered list does not. */
  readonly searchable = input(false);

  protected readonly query = signal('');

  protected readonly groups = computed(() => {
    const needle = this.query().trim().toLowerCase();
    if (!needle) return groupOperations(this.operations());
    return groupOperations(
      this.operations().filter((operation) => haystack(operation).includes(needle)),
    );
  });

  protected readonly brief = briefRequirementOf;
}

/**
 * Includes the group label, so "audio" finds everything in the audio group and
 * not just the two jobs with the word in their title.
 */
function haystack(operation: Operation): string {
  return `${operation.title} ${operation.summary} ${operation.verb} ${GROUP_LABELS[operation.group]}`.toLowerCase();
}
