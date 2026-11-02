// File: programs/univibe_core/src/lib.rs

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("UniVibe1111111111111111111111111111111111111");

#[program]
pub mod univibe_core {
    use super::*;

    /// Initializes a new campus bounty escrow with locked SOL.
    pub fn initialize_bounty(
        ctx: Context<InitializeBounty>,
        bounty_id: u64,
        title: String,
        description_hash: [u8; 32],
        payout_amount: u64,
        deadline_timestamp: i64,
    ) -> Result<()> {
        require!(title.len() <= 64, UniVibeError::TitleTooLong);
        require!(payout_amount > 0, UniVibeError::ZeroPayoutAmount);
        
        let clock = Clock::get()?;
        require!(
            deadline_timestamp > clock.unix_timestamp,
            UniVibeError::InvalidDeadline
        );

        let bounty = &mut ctx.accounts.bounty;
        bounty.initiator = ctx.accounts.initiator.key();
        bounty.arbiter = ctx.accounts.arbiter.key();
        bounty.contributor = Pubkey::default();
        bounty.bounty_id = bounty_id;
        bounty.title = title;
        bounty.description_hash = description_hash;
        bounty.submission_hash = [0u8; 32];
        bounty.payout_amount = payout_amount;
        bounty.deadline_timestamp = deadline_timestamp;
        bounty.state = BountyState::Open;
        bounty.bump = ctx.bumps.bounty;
        bounty.vault_bump = ctx.bumps.vault;

        // Escrow funds transfer from initiator to vault PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.initiator.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        transfer(cpi_context, payout_amount)?;

        emit!(BountyInitializedEvent {
            bounty_id,
            initiator: ctx.accounts.initiator.key(),
            arbiter: ctx.accounts.arbiter.key(),
            payout_amount,
            deadline_timestamp,
        });

        Ok(())
    }

    /// Contributor claims and submits evidence (IPFS sha256 hash).
    pub fn submit_milestone(
        ctx: Context<SubmitMilestone>,
        submission_hash: [u8; 32],
    ) -> Result<()> {
        let bounty = &mut ctx.accounts.bounty;
        let clock = Clock::get()?;

        require!(
            bounty.state == BountyState::Open || bounty.state == BountyState::Assigned,
            UniVibeError::InvalidStateTransition
        );
        require!(
            clock.unix_timestamp <= bounty.deadline_timestamp,
            UniVibeError::BountyExpired
        );

        bounty.contributor = ctx.accounts.contributor.key();
        bounty.submission_hash = submission_hash;
        bounty.state = BountyState::Submitted;

        emit!(MilestoneSubmittedEvent {
            bounty_id: bounty.bounty_id,
            contributor: ctx.accounts.contributor.key(),
            submission_hash,
        });

        Ok(())
    }

    /// Sponsor or Arbiter approves the submission and releases funds.
    pub fn release_bounty(ctx: Context<ReleaseBounty>) -> Result<()> {
        let bounty = &ctx.accounts.bounty;
        let signer = ctx.accounts.authority.key();

        require!(
            signer == bounty.initiator || signer == bounty.arbiter,
            UniVibeError::UnauthorizedSettlement
        );
        require!(
            bounty.state == BountyState::Submitted,
            UniVibeError::NotReadyForSettlement
        );

        let bounty_id_bytes = bounty.bounty_id.to_le_bytes();
        let seeds = &[
            b"vault",
            ctx.accounts.bounty.to_account_info().key.as_ref(),
            &[bounty.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer funds from program-controlled vault PDA to contributor
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.contributor.to_account_info(),
            },
            signer_seeds,
        );
        transfer(cpi_context, bounty.payout_amount)?;

        let bounty_mut = &mut ctx.accounts.bounty;
        bounty_mut.state = BountyState::Completed;

        emit!(BountySettledEvent {
            bounty_id: bounty_mut.bounty_id,
            beneficiary: ctx.accounts.contributor.key(),
            amount: bounty_mut.payout_amount,
        });

        Ok(())
    }

    /// Refunds sponsor if deadline expired without valid submission or if resolved by Arbiter.
    pub fn refund_bounty(ctx: Context<RefundBounty>) -> Result<()> {
        let bounty = &ctx.accounts.bounty;
        let clock = Clock::get()?;
        let signer = ctx.accounts.authority.key();

        let can_refund = (signer == bounty.initiator && clock.unix_timestamp > bounty.deadline_timestamp && bounty.state != BountyState::Submitted)
            || (signer == bounty.arbiter);

        require!(can_refund, UniVibeError::RefundConditionNotMet);
        require!(
            bounty.state != BountyState::Completed && bounty.state != BountyState::Refunded,
            UniVibeError::InvalidStateTransition
        );

        let seeds = &[
            b"vault",
            ctx.accounts.bounty.to_account_info().key.as_ref(),
            &[bounty.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.initiator.to_account_info(),
            },
            signer_seeds,
        );
        transfer(cpi_context, bounty.payout_amount)?;

        let bounty_mut = &mut ctx.accounts.bounty;
        bounty_mut.state = BountyState::Refunded;

        emit!(BountyRefundedEvent {
            bounty_id: bounty_mut.bounty_id,
            refund_destination: ctx.accounts.initiator.key(),
            amount: bounty_mut.payout_amount,
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION STRUCTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(bounty_id: u64)]
pub struct InitializeBounty<'info> {
    #[account(
        init,
        payer = initiator,
        space = 8 + Bounty::INIT_SPACE,
        seeds = [b"bounty", initiator.key().as_ref(), &bounty_id.to_le_bytes()],
        bump
    )]
    pub bounty: Account<'info, Bounty>,

    /// CHECK: Vault PDA derived deterministically from the bounty PDA
    #[account(
        mut,
        seeds = [b"vault", bounty.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    /// Arbiter account authorized for resolution (e.g. KUBG Hackathon Committee)
    /// CHECK: Verified as an arbitrary valid SystemAccount or PDA
    pub arbiter: AccountInfo<'info>,

    #[account(mut)]
    pub initiator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitMilestone<'info> {
    #[account(
        mut,
        seeds = [b"bounty", bounty.initiator.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump
    )]
    pub bounty: Account<'info, Bounty>,

    #[account(mut)]
    pub contributor: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReleaseBounty<'info> {
    #[account(
        mut,
        seeds = [b"bounty", bounty.initiator.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump
    )]
    pub bounty: Account<'info, Bounty>,

    /// CHECK: Vault holding the escrowed native SOL
    #[account(
        mut,
        seeds = [b"vault", bounty.key().as_ref()],
        bump = bounty.vault_bump
    )]
    pub vault: SystemAccount<'info>,

    /// CHECK: Validated against stored bounty.contributor
    #[account(
        mut,
        constraint = contributor.key() == bounty.contributor @ UniVibeError::InvalidContributor
    )]
    pub contributor: SystemAccount<'info>,

    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundBounty<'info> {
    #[account(
        mut,
        seeds = [b"bounty", bounty.initiator.as_ref(), &bounty.bounty_id.to_le_bytes()],
        bump = bounty.bump
    )]
    pub bounty: Account<'info, Bounty>,

    /// CHECK: Vault holding the escrowed native SOL
    #[account(
        mut,
        seeds = [b"vault", bounty.key().as_ref()],
        bump = bounty.vault_bump
    )]
    pub vault: SystemAccount<'info>,

    /// CHECK: Must match the bounty initiator
    #[account(
        mut,
        constraint = initiator.key() == bounty.initiator @ UniVibeError::UnauthorizedInitiator
    )]
    pub initiator: SystemAccount<'info>,

    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// -----------------------------------------------------------------------------
// STATE DEFINITIONS
// -----------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BountyState {
    Open,
    Assigned,
    Submitted,
    Completed,
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct Bounty {
    pub initiator: Pubkey,          // 32
    pub arbiter: Pubkey,            // 32
    pub contributor: Pubkey,        // 32
    pub bounty_id: u64,             // 8
    #[max_len(64)]
    pub title: String,              // 4 + 64
    pub description_hash: [u8; 32], // 32
    pub submission_hash: [u8; 32],  // 32
    pub payout_amount: u64,         // 8
    pub deadline_timestamp: i64,    // 8
    pub state: BountyState,         // 1
    pub bump: u8,                   // 1
    pub vault_bump: u8,             // 1
}

// -----------------------------------------------------------------------------
// EVENTS
// -----------------------------------------------------------------------------

#[event]
pub struct BountyInitializedEvent {
    pub bounty_id: u64,
    pub initiator: Pubkey,
    pub arbiter: Pubkey,
    pub payout_amount: u64,
    pub deadline_timestamp: i64,
}

#[event]
pub struct MilestoneSubmittedEvent {
    pub bounty_id: u64,
    pub contributor: Pubkey,
    pub submission_hash: [u8; 32],
}

#[event]
pub struct BountySettledEvent {
    pub bounty_id: u64,
    pub beneficiary: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BountyRefundedEvent {
    pub bounty_id: u64,
    pub refund_destination: Pubkey,
    pub amount: u64,
}

// -----------------------------------------------------------------------------
// ERROR CODES
// -----------------------------------------------------------------------------

#[error_code]
pub enum UniVibeError {
    #[msg("Title string exceeds maximum length of 64 bytes")]
    TitleTooLong,
    #[msg("Payout amount must be greater than zero")]
    ZeroPayoutAmount,
    #[msg("Deadline must be strictly set in the future")]
    InvalidDeadline,
    #[msg("Operation invalid under current bounty state")]
    InvalidStateTransition,
    #[msg("Bounty has already reached its expiration timestamp")]
    BountyExpired,
    #[msg("Signer is neither the initiator nor designated arbiter")]
    UnauthorizedSettlement,
    #[msg("Submission hash must be recorded before releasing bounty")]
    NotReadyForSettlement,
    #[msg("Refund conditions not satisfied")]
    RefundConditionNotMet,
    #[msg("Recipient account does not match registered contributor")]
    InvalidContributor,
    #[msg("Recipient account does not match original initiator")]
    UnauthorizedInitiator,
}