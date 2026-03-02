import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ProjectSidebar from '@/components/ProjectSidebar';

describe('ProjectSidebar', () => {
  const projects = [
    { id: 'p1', dir: 'D:/dev/repo-a', colorIndex: 0 },
    { id: 'p2', dir: 'D:/dev/repo-b', colorIndex: 1 },
  ];
  const tabCounts = {
    p1: { idle: 1, working: 1, requires_response: 0, total: 2 },
    p2: { idle: 0, working: 0, requires_response: 1, total: 1 },
  };

  it('renders project names from directory paths', () => {
    render(
      <ProjectSidebar
        projects={projects}
        activeProjectId="p1"
        tabCounts={tabCounts}
        collapsed={false}
        onSelectProject={vi.fn()}
        onAddProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onRenameProject={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    );
    expect(screen.getByText('repo-a')).toBeTruthy();
    expect(screen.getByText('repo-b')).toBeTruthy();
  });

  it('calls onSelectProject when clicked', () => {
    const onSelect = vi.fn();
    render(
      <ProjectSidebar
        projects={projects}
        activeProjectId="p1"
        tabCounts={tabCounts}
        collapsed={false}
        onSelectProject={onSelect}
        onAddProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onRenameProject={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('repo-b'));
    expect(onSelect).toHaveBeenCalledWith('p2');
  });

  it('highlights active project', () => {
    render(
      <ProjectSidebar
        projects={projects}
        activeProjectId="p1"
        tabCounts={tabCounts}
        collapsed={false}
        onSelectProject={vi.fn()}
        onAddProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onRenameProject={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    );
    const activeBtn = screen.getByText('repo-a').closest('button');
    expect(activeBtn?.getAttribute('data-active')).toBe('true');
  });

  it('calls onAddProject when add button clicked', () => {
    const onAdd = vi.fn();
    render(
      <ProjectSidebar
        projects={projects}
        activeProjectId="p1"
        tabCounts={tabCounts}
        collapsed={false}
        onSelectProject={vi.fn()}
        onAddProject={onAdd}
        onRemoveProject={vi.fn()}
        onRenameProject={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTitle('Add project'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('shows working and response counts', () => {
    const { container } = render(
      <ProjectSidebar
        projects={projects}
        activeProjectId="p1"
        tabCounts={tabCounts}
        collapsed={false}
        onSelectProject={vi.fn()}
        onAddProject={vi.fn()}
        onRemoveProject={vi.fn()}
        onRenameProject={vi.fn()}
        onToggleCollapse={vi.fn()}
      />
    );
    // p1 has 1 working
    expect(container.querySelector('[data-count-working]')?.textContent).toBe('1');
    // p2 has 1 requires_response
    expect(container.querySelector('[data-count-response]')?.textContent).toBe('1');
  });
});
