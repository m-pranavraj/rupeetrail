import React, { useMemo, useState } from 'react'
import type { Group } from '../types'
import { useStore } from '../lib/store'
import { computeBalances } from '../lib/balances'
import { formatPaise } from '../lib/money'
import { planSettlements } from '../lib/settlement'
import { AvatarStack, EmptyState, Segmented, Sheet, StatusPill } from './ui'
import { IconAlert, IconBack, IconPlus, IconRefresh, IconShare } from './Icons'
import { ExpensesTab } from './ExpensesTab'
import { BalancesTab } from './BalancesTab'
import { SettleTab } from './SettleTab'
import { ExpenseForm } from './ExpenseForm'
import { ExpenseDetail } from './ExpenseDetail'
import { InviteSheet } from './InviteSheet'

type Tab = 'expenses' | 'balances' | 'settle'

const EMOJI_CHOICES = ['🏖️', '🏠', '✈️', '🎉', '🍻', '🏏', '🎓', '🚗', '🎿', '🍕', '💼', '🌮']

export function GroupScreen({ groupId, onBack }: { groupId: string; onBack: () => void }) {
  const {
    active,
    activeMembership,
    loading,
    live,
    presence,
    addExpense,
    addMember,
    removeMember,
    updateExpense,
    renameGroup,
    setGroupStatus,
    leaveGroup,
    refresh,
  } = useStore()
  const [tab, setTab] = useState<Tab>('expenses')
  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const snapshot = active && active.group.id === groupId ? active : null
  const group = snapshot?.group ?? null
  const expenses = snapshot?.expenses ?? []
  const settlements = snapshot?.settlements ?? []

  const currentMemberId = useMemo(() => {
    if (!group || !activeMembership) return undefined
    return group.members.some((m) => m.id === activeMembership.memberId)
      ? activeMembership.memberId
      : undefined
  }, [group, activeMembership])

  const summary = useMemo(() => {
    if (!group) return { mine: 0, transfers: 0 }
    const balances = computeBalances({ group, expenses, settlements })
    const plan = planSettlements(balances)
    return {
      mine: balances.find((b) => b.memberId === currentMemberId)?.netPaise ?? 0,
      transfers: plan.transfers.length,
    }
  }, [group, expenses, settlements, currentMemberId])

  if (!group) {
    if (loading) {
      return (
        <div className="screen group">
          <div className="group__head">
            <button className="icon-btn" onClick={onBack} aria-label="Back to groups">
              <IconBack size={22} />
            </button>
          </div>
          <div className="skeleton skeleton--hero" />
          <div className="skeleton skeleton--row" />
          <div className="skeleton skeleton--row" />
        </div>
      )
    }
    return (
      <div className="screen group">
        <header className="group__head">
          <button className="icon-btn" onClick={onBack} aria-label="Back to groups">
            <IconBack size={22} />
          </button>
        </header>
        <EmptyState
          icon={<IconAlert size={24} />}
          title="Group not available"
          body="This phone does not have access to that group. Open the invite link again, or ask for a fresh one."
          action={
            <button className="btn btn--primary" onClick={onBack}>
              Back to my groups
            </button>
          }
        />
      </div>
    )
  }

  const detailExpense = detailId ? expenses.find((e) => e.id === detailId) : undefined
  const editingExpense = editingId ? expenses.find((e) => e.id === editingId) : undefined
  const closed = group.status === 'closed'

  return (
    <div className="screen group">
      <header className="group__head">
        <button className="icon-btn" onClick={onBack} aria-label="Back to groups">
          <IconBack size={22} />
        </button>
        <div className="group__title">
          <span className="group__emoji" aria-hidden>
            {group.emoji}
          </span>
          <div>
            <h1>{group.name}</h1>
            <p className="group__sub">
              {group.members.filter((m) => !m.leftAt).length} members ·{' '}
              <span className={`live-inline live-inline--${live}`}>
                {live === 'live'
                  ? presence > 1
                    ? `${presence} here now`
                    : 'live'
                  : live === 'connecting'
                    ? 'connecting…'
                    : 'syncing'}
              </span>
            </p>
          </div>
        </div>
        <div className="group__head-actions">
          <button className="icon-btn" onClick={() => setInviteOpen(true)} aria-label="Invite people">
            <IconShare size={20} />
          </button>
          <button className="icon-btn" onClick={() => void refresh()} aria-label="Refresh ledger">
            <IconRefresh size={20} />
          </button>
          <button className="settings-btn" onClick={() => setSettingsOpen(true)} aria-label="Group settings">
            ⋯
          </button>
        </div>
      </header>

      <section className={`group-hero ${summary.mine > 0 ? 'is-pos' : summary.mine < 0 ? 'is-neg' : ''}`}>
        <div>
          <p className="group-hero__label">Your position</p>
          <p className="group-hero__value">
            {summary.mine === 0
              ? 'Settled up'
              : summary.mine > 0
                ? `${formatPaise(summary.mine)} due`
                : `${formatPaise(-summary.mine)} owed`}
          </p>
        </div>
        <div className="group-hero__right">
          <AvatarStack members={group.members.filter((m) => !m.leftAt)} max={4} />
          {summary.transfers > 0 && (
            <span className="group-hero__hint">
              {summary.transfers} transfer{summary.transfers === 1 ? '' : 's'} to clear
            </span>
          )}
          {expenses.some((e) => e.dispute?.status === 'open') && (
            <span className="group-hero__flag">
              <IconAlert size={12} /> question open
            </span>
          )}
        </div>
      </section>

      <div className="tabs">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'expenses', label: 'Expenses' },
            { value: 'balances', label: 'Balances' },
            { value: 'settle', label: 'Settle' },
          ]}
        />
      </div>

      <main className="group__body">
        {tab === 'expenses' && (
          <ExpensesTab
            group={group}
            expenses={expenses}
            currentMemberId={currentMemberId}
            onOpenExpense={setDetailId}
            onAdd={() => setAddOpen(true)}
          />
        )}
        {tab === 'balances' && (
          <BalancesTab
            group={group}
            expenses={expenses}
            settlements={settlements}
            currentMemberId={currentMemberId}
          />
        )}
        {tab === 'settle' && (
          <SettleTab
            group={group}
            expenses={expenses}
            settlements={settlements}
            currentMemberId={currentMemberId}
          />
        )}
      </main>

      {tab === 'expenses' && !closed && (
        <button className="fab" onClick={() => setAddOpen(true)} aria-label="Add expense">
          <IconPlus size={24} />
        </button>
      )}

      <Sheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add expense"
        subtitle="Log what was paid. Everyone in the group sees it immediately."
      >
        <ExpenseForm
          group={group}
          currentMemberId={currentMemberId}
          onCancel={() => setAddOpen(false)}
          onSave={async (input) => {
            const ok = await addExpense(group.id, input)
            if (ok) setAddOpen(false)
          }}
        />
      </Sheet>

      <Sheet
        open={!!editingExpense}
        onClose={() => setEditingId(null)}
        title="Edit expense"
        subtitle="Every edit bumps the revision, so the group can see what changed."
      >
        {editingExpense && (
          <ExpenseForm
            group={group}
            currentMemberId={currentMemberId}
            expense={editingExpense}
            onCancel={() => setEditingId(null)}
            onSave={async (input) => {
              const ok = await updateExpense(group.id, editingExpense.id, input)
              if (ok) setEditingId(null)
            }}
          />
        )}
      </Sheet>

      {detailExpense && (
        <ExpenseDetail
          group={group}
          expense={detailExpense}
          currentMemberId={currentMemberId}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setEditingId(detailExpense.id)
            setDetailId(null)
          }}
        />
      )}

      <InviteSheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        group={group}
        code={snapshot?.code ?? ''}
        currentMemberId={currentMemberId}
        onAddMember={(name, upiId) => addMember(group.id, name, upiId)}
        onRemoveMember={(memberId) => removeMember(group.id, memberId)}
      />

      <SettingsSheet
        open={settingsOpen}
        group={group}
        onClose={() => setSettingsOpen(false)}
        onSave={async (name, emoji) => {
          const ok = await renameGroup(group.id, name, emoji)
          if (ok) setSettingsOpen(false)
        }}
        onStatus={async (status) => {
          const ok = await setGroupStatus(group.id, status)
          if (ok) setSettingsOpen(false)
        }}
        onLeave={() => {
          if (
            confirm(
              'Remove this group from this phone? The ledger stays for everyone else, and you can rejoin with the invite link.',
            )
          ) {
            leaveGroup(group.id)
            setSettingsOpen(false)
            onBack()
          }
        }}
        onInvite={() => {
          setSettingsOpen(false)
          setInviteOpen(true)
        }}
      />
    </div>
  )
}

function SettingsSheet({
  open,
  group,
  onClose,
  onSave,
  onStatus,
  onLeave,
  onInvite,
}: {
  open: boolean
  group: Group
  onClose: () => void
  onSave: (name: string, emoji: string) => Promise<void>
  onStatus: (status: Group['status']) => Promise<void>
  onLeave: () => void
  onInvite: () => void
}) {
  const [name, setName] = useState(group.name)
  const [emoji, setEmoji] = useState(group.emoji)
  const [saving, setSaving] = useState(false)
  const [signature, setSignature] = useState(`${open}-${group.name}-${group.emoji}`)

  if (signature !== `${open}-${group.name}-${group.emoji}`) {
    setSignature(`${open}-${group.name}-${group.emoji}`)
    setName(group.name)
    setEmoji(group.emoji)
  }

  return (
    <Sheet open={open} onClose={onClose} title="Group settings" subtitle="Rename, invite, or move the group through its lifecycle.">
      <div className="form">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        <div className="field">
          <span>Icon</span>
          <div className="emoji-grid">
            {EMOJI_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                className={`emoji-choice${emoji === choice ? ' is-active' : ''}`}
                onClick={() => setEmoji(choice)}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>
        <button
          className="btn btn--primary btn--block"
          disabled={!name.trim() || saving}
          onClick={async () => {
            setSaving(true)
            await onSave(name.trim(), emoji)
            setSaving(false)
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>

        <button className="btn btn--soft btn--block" onClick={onInvite}>
          <IconShare size={17} /> Invite people
        </button>

        <div className="status-block">
          <p className="field-label">Group status</p>
          <div className="status-options">
            {(
              [
                { value: 'active', label: 'Active', desc: 'Normal capture and edits.' },
                { value: 'reconciling', label: 'Reconciling', desc: 'Wind down: fix disputes before closing.' },
                { value: 'closed', label: 'Closed', desc: 'Read-only snapshot; reopen to change.' },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                className={`status-option${group.status === option.value ? ' is-active' : ''}`}
                onClick={() => void onStatus(option.value)}
              >
                <span>{option.label}</span>
                <em>{option.desc}</em>
              </button>
            ))}
          </div>
          {group.status === 'closed' && (
            <StatusPill tone="muted">
              Closed on {new Date(group.closedAt ?? Date.now()).toLocaleDateString('en-IN')}
            </StatusPill>
          )}
        </div>

        <button className="link-btn link-btn--danger" onClick={onLeave}>
          Remove this group from my phone
        </button>
      </div>
    </Sheet>
  )
}
