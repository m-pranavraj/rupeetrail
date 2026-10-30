import React, { useMemo } from 'react'
import type { Expense, MemberId } from '../types'
import { buildGroupDues } from '../lib/payback'
import { formatPaise } from '../lib/money'
import { Avatar, StatusPill } from './ui'
import { IconUsers } from './Icons'

function shortName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/**
 * A payer × payee table for the whole group. Rows owe columns, and each cell
 * is the full amount from the actual expenses — never netted against payments.
 */
export function GroupDuesCard({
  expenses,
  memberIds,
  meId,
  nameOf,
  colorOf,
}: {
  expenses: Expense[]
  memberIds: MemberId[]
  meId?: MemberId
  nameOf: (id: MemberId) => string
  colorOf: (id: MemberId) => number
}) {
  const view = useMemo(
    () => buildGroupDues(expenses, { memberIds }),
    [expenses, memberIds],
  )
  const empty = view.pairCount === 0

  return (
    <section className="plan-card dues-card">
      <div className="plan-card__head">
        <h3>
          <IconUsers size={17} /> Everyone&rsquo;s dues
        </h3>
        <StatusPill tone={empty ? 'muted' : 'ok'}>
          {view.pairCount} {view.pairCount === 1 ? 'due' : 'dues'}
        </StatusPill>
      </div>

      <p className="payback-sub">
        Rows owe columns. Read across a row to see whom that person owes; read down a column to see
        who owes them. Every amount is built from the actual expenses, and payments are never
        subtracted here.
      </p>

      {empty ? (
        <div className="payback-empty">
          <p>
            {expenses.some((expense) => !expense.deletedAt && expense.amountPaise > 0)
              ? 'Nothing is pending between anyone.'
              : 'No shared expenses yet.'}
          </p>
        </div>
      ) : (
        <>
          <div className="dues-totals">
            <span>
              <strong>{formatPaise(view.totalPaise)}</strong> pending between {view.pairCount}{' '}
              {view.pairCount === 1 ? 'pair' : 'pairs'}
            </span>
            <span>
              {view.expenseCount} {view.expenseCount === 1 ? 'expense' : 'expenses'} behind it
            </span>
            <span>payments not deducted</span>
          </div>

          <div className="dues-table-wrap">
            <table
              className="dues-table"
              aria-label="Gross amount each person owes each other person"
            >
              <thead>
                <tr>
                  <th scope="col" className="dues-table__corner">
                    <span>Owes</span>
                    <small>to &rarr;</small>
                  </th>
                  {view.members.map((member) => (
                    <th scope="col" key={member.memberId}>
                      <span title={nameOf(member.memberId)}>
                        {shortName(nameOf(member.memberId))}
                      </span>
                    </th>
                  ))}
                  <th scope="col" className="dues-table__sum">
                    Owes
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.members.map((row) => {
                  const rowName = nameOf(row.memberId)
                  return (
                    <tr key={row.memberId}>
                      <th scope="row" className="dues-table__person">
                        <Avatar name={rowName} color={colorOf(row.memberId)} size={22} />
                        <span className="dues-table__name">
                          {shortName(rowName)}
                          {row.memberId === meId ? <em>you</em> : null}
                        </span>
                      </th>
                      {view.members.map((column) => {
                        if (column.memberId === row.memberId) {
                          return (
                            <td key={column.memberId} className="is-self">
                              &middot;
                            </td>
                          )
                        }
                        const edge = row.owes.find(
                          (entry) => entry.memberId === column.memberId,
                        )
                        return (
                          <td
                            key={column.memberId}
                            className={edge ? 'is-due' : undefined}
                            title={
                              edge
                                ? `${edge.expenseCount} ${
                                    edge.expenseCount === 1 ? 'expense' : 'expenses'
                                  }`
                                : undefined
                            }
                          >
                            {edge ? formatPaise(edge.amountPaise) : <span className="dues-dash">—</span>}
                          </td>
                        )
                      })}
                      <td className="dues-table__sum">
                        {row.owesPaise > 0 ? (
                          formatPaise(row.owesPaise)
                        ) : (
                          <span className="dues-dash">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Gets</th>
                  {view.members.map((member) => (
                    <td key={member.memberId}>
                      {member.owedByPaise > 0 ? (
                        formatPaise(member.owedByPaise)
                      ) : (
                        <span className="dues-dash">—</span>
                      )}
                    </td>
                  ))}
                  <td className="dues-table__sum">{formatPaise(view.totalPaise)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="dues-legend">
            Totals are gross: every expense is counted in full for the person who paid. Recorded
            payments stay separate and are never subtracted from this table.
          </p>
        </>
      )}
    </section>
  )
}
