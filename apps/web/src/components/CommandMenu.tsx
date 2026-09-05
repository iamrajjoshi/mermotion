import { Command } from 'cmdk';
import { CornerDownLeft, Search } from 'lucide-react';

export interface CommandAction {
  group: string;
  keywords?: string[];
  label: string;
  shortcut?: string;
  run: () => void;
}

interface CommandMenuProps {
  actions: CommandAction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandMenu({ actions, open, onOpenChange }: CommandMenuProps) {
  const groups = actions.reduce<Map<string, CommandAction[]>>((result, action) => {
    const group = result.get(action.group) ?? [];
    group.push(action);
    result.set(action.group, group);
    return result;
  }, new Map());

  return (
    <Command.Dialog
      contentClassName="command-dialog"
      label="Mermotion commands"
      onOpenChange={onOpenChange}
      open={open}
      overlayClassName="command-overlay"
    >
      <div className="command-input-row">
        <Search aria-hidden="true" size={17} />
        <Command.Input autoFocus placeholder="Type a command or search…" />
        <kbd>esc</kbd>
      </div>
      <Command.List className="command-list">
        <Command.Empty className="command-empty">No matching command</Command.Empty>
        {[...groups.entries()].map(([group, groupActions]) => (
          <Command.Group heading={group} key={group}>
            {groupActions.map((action) => (
              <Command.Item
                key={action.label}
                onSelect={() => {
                  action.run();
                  onOpenChange(false);
                }}
                value={action.label}
                {...(action.keywords ? { keywords: action.keywords } : {})}
              >
                <span>{action.label}</span>
                {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
      <footer className="command-footer">
        <span>
          <CornerDownLeft aria-hidden="true" size={12} /> select
        </span>
        <span>↑↓ navigate</span>
      </footer>
    </Command.Dialog>
  );
}
