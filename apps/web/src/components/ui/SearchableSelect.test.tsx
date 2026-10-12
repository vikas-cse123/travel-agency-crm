import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelect } from './SearchableSelect';

const OPTIONS = [
  { value: 'Mumbai', label: 'Mumbai' },
  { value: 'Delhi', label: 'Delhi' },
  { value: 'Chennai', label: 'Chennai' },
  { value: 'Germany', label: 'Germany' },
];

function renderSelect(initialValue = '', onChange = vi.fn()) {
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return (
      <SearchableSelect
        ariaLabel="Test field"
        placeholder="Select option"
        options={OPTIONS}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { onChange, input: screen.getByLabelText('Test field') as HTMLInputElement };
}

describe('SearchableSelect search regression', () => {
  it('filters as characters are typed', async () => {
    const { input } = renderSelect();
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'del' } });
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Mumbai' })).not.toBeInTheDocument();
    expect(input).toHaveValue('del');
  });

  it('updates results when the last character is deleted with Backspace', async () => {
    const { input } = renderSelect('Mumbai');
    expect(input).toHaveValue('Mumbai');
    await userEvent.click(input);
    // Editing starts from the selection: "Mumbai" -> "Mumba".
    fireEvent.change(input, { target: { value: 'Mumba' } });
    expect(input).toHaveValue('Mumba');
    expect(screen.getByRole('option', { name: 'Mumbai' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Delhi' })).not.toBeInTheDocument();
  });

  it('updates results when multiple characters are deleted', async () => {
    const { input } = renderSelect('Chennai');
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'Chenna' } });
    expect(screen.getByRole('option', { name: 'Chennai' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Che' } });
    expect(screen.getByRole('option', { name: 'Chennai' })).toBeInTheDocument();
    expect(input).toHaveValue('Che');
  });

  it('supports edits in the middle of the query', async () => {
    const { input } = renderSelect();
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'Delh' } });
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    // Insert in the middle: "Delh" -> "Delhi" is covered; simulate a middle
    // replacement that still matches Delhi and nothing else.
    fireEvent.change(input, { target: { value: 'Delhi' } });
    expect(input).toHaveValue('Delhi');
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Chennai' })).not.toBeInTheDocument();
  });

  it('stays empty (showing every option) when the whole search is cleared', async () => {
    const { input } = renderSelect('Mumbai');
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: '' } });
    // Must not snap back to the old selection while open.
    expect(input).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Mumbai' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Chennai' })).toBeInTheDocument();
  });

  it('starts a fresh search immediately after clearing', async () => {
    const { input } = renderSelect('Mumbai');
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Delhi' } });
    expect(input).toHaveValue('Delhi');
    expect(screen.getByRole('option', { name: 'Delhi' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Mumbai' })).not.toBeInTheDocument();
  });

  it('selects a result with the mouse', async () => {
    const onChange = vi.fn();
    const { input } = renderSelect('', onChange);
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'chenn' } });
    await userEvent.click(screen.getByRole('option', { name: 'Chennai' }));
    expect(onChange).toHaveBeenCalledWith('Chennai');
    expect(input).toHaveValue('Chennai');
    expect(
      screen.queryByRole('listbox', { name: 'Test field search results' }),
    ).not.toBeInTheDocument();
  });

  it('supports keyboard search and selection plus Escape', async () => {
    const onChange = vi.fn();
    const { input } = renderSelect('', onChange);
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'german' } });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('Germany');
    expect(input).toHaveValue('Germany');

    await userEvent.click(input);
    expect(
      screen.getByRole('listbox', { name: 'Test field search results' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByRole('listbox', { name: 'Test field search results' }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue('Germany');
  });

  it('reopens on the selection after close and allows a new search', async () => {
    const onChange = vi.fn();
    const { input } = renderSelect('', onChange);
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'delh' } });
    await userEvent.click(screen.getByRole('option', { name: 'Delhi' }));
    expect(input).toHaveValue('Delhi');
    // Commit closes the menu.
    expect(
      screen.queryByRole('listbox', { name: 'Test field search results' }),
    ).not.toBeInTheDocument();

    // Reopen: the selection is shown again with the full list.
    await userEvent.click(input);
    expect(input).toHaveValue('Delhi');
    expect(
      screen.getByRole('listbox', { name: 'Test field search results' }),
    ).toBeInTheDocument();

    // Toggle closed: reverts to the committed selection.
    await userEvent.click(input);
    expect(
      screen.queryByRole('listbox', { name: 'Test field search results' }),
    ).not.toBeInTheDocument();
    expect(input).toHaveValue('Delhi');

    // Reopen once more and run a new search.
    await userEvent.click(input);
    expect(
      screen.getByRole('listbox', { name: 'Test field search results' }),
    ).toBeInTheDocument();

    // A new query from the reopened state filters correctly.
    fireEvent.change(input, { target: { value: 'Mumbai' } });
    expect(screen.getByRole('option', { name: 'Mumbai' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Delhi' })).not.toBeInTheDocument();
  });

  it('clears the value with the clear button and accepts a new search', async () => {
    const onChange = vi.fn();
    const { input } = renderSelect('Delhi', onChange);
    await userEvent.click(screen.getByLabelText('Clear Test field'));
    expect(onChange).toHaveBeenCalledWith('');
    expect(input).toHaveValue('');
  });
});
