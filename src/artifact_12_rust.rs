use anchor_lang::prelude::*;
use crate::errors::UniVibeError;
use crate::events::DisputeResolved;
use crate::state::{Bounty, BountyStatus};

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        seeds = [b"bounty", bounty.sponsor.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump,
        has_one = arbitrator @ UniVibeError::Unauthorized
    )]
    pub bounty: Account<'info, Bounty>,

    /// CHECK: Native lamport vault PDA
    #[account(
        mut,
        seeds = [b"vault", bounty.key().as_ref()],
        bump = bounty.vault_bump
    )]
    pub vault: AccountInfo<'info>,

    /// CHECK: Contributor recipient
    #[account(mut, address = bounty.contributor)]
    pub contributor: AccountInfo<'info>,

    /// CHECK: Sponsor recipient
    #[account(mut, address = bounty.sponsor)]
    pub sponsor: AccountInfo<'info>,

    pub arbitrator: Signer<'info>,
}

pub fn handler(ctx: Context<ResolveDispute>, contributor_share_basis_points: u16) -> Result<()> {
    require!(contributor_share_basis_points <= 10_000, UniVibeError::InvalidBasisPoints);
    let bounty = &mut ctx.accounts.bounty;
    
    require!(
        bounty.status == BountyStatus::Submitted || bounty.status == BountyStatus::Created,
        UniVibeError::InvalidStatusTransition
    );

    let total_amount = bounty.amount;
    let contributor_amount = (total_amount as u128)
        .checked_mul(contributor_share_basis_points as u128)
        .ok_or(UniVibeError::ArithmeticOverflow)?
        .checked_div(10_000)
        .ok_or(UniVibeError::ArithmeticOverflow)? as u64;

    let sponsor_amount = total_amount
        .checked_sub(contributor_amount)
        .ok_or(UniVibeError::ArithmeticOverflow)?;

    let vault_balance = ctx.accounts.vault.lamports();
    require!(vault_balance >= total_amount, UniVibeError::ArithmeticOverflow);

    // Split settlement
    if contributor_amount > 0 {
        **ctx.accounts.vault.try_borrow_mut_lamports()? -= contributor_amount;
        **ctx.accounts.contributor.try_borrow_mut_lamports()? += contributor_amount;
    }

    if sponsor_amount > 0 {
        **ctx.accounts.vault.try_borrow_mut_lamports()? -= sponsor_amount;
        **ctx.accounts.sponsor.try_borrow_mut_lamports()? += sponsor_amount;
    }

    bounty.status = BountyStatus::Completed;

    emit!(DisputeResolved {
        bounty_id: bounty.bounty_id,
        arbitrator: ctx.accounts.arbitrator.key(),
        contributor_amount,
        sponsor_amount,
    });

    Ok(())
}