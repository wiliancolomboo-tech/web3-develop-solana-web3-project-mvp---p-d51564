use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("V1BE4aH8bSm3mXyN2r5q8V1BE4aH8bSm3mXyN2r5q8AA");

pub const MAX_METADATA_LEN: usize = 128;
pub const MAX_TITLE_LEN: usize = 64;

#[program]
pub mod univibe_protocol {
    use super::*;

    /// Initialize a new Grant Escrow targeting a specific recipient and milestone count.
    pub fn initialize_grant(
        ctx: Context<InitializeGrant>,
        title: String,
        metadata_cid: String,
        total_funding_amount: u64,
        total_milestones: u8,
        approval_threshold: u8,
        deadline_slot: u64,
    ) -> Result<()> {
        require!(title.len() <= MAX_TITLE_LEN, UniVibeError::TitleTooLong);
        require!(metadata_cid.len() <= MAX_METADATA_LEN, UniVibeError::MetadataTooLong);
        require!(total_milestones > 0, UniVibeError::InvalidMilestoneCount);
        require!(approval_threshold > 0, UniVibeError::InvalidApprovalThreshold);
        require!(total_funding_amount > 0, UniVibeError::ZeroFundingAmount);
        
        let current_slot = Clock::get()?.slot;
        require!(deadline_slot > current_slot, UniVibeError::InvalidDeadline);

        let grant = &mut ctx.accounts.grant_account;
        grant.sponsor = ctx.accounts.sponsor.key();
        grant.recipient = ctx.accounts.recipient.key();
        grant.vault = ctx.accounts.vault.key();
        grant.title = title;
        grant.metadata_cid = metadata_cid;
        grant.total_funding_amount = total_funding_amount;
        grant.amount_disbursed = 0;
        grant.total_milestones = total_milestones;
        grant.current_milestone = 0;
        grant.approval_threshold = approval_threshold;
        grant.deadline_slot = deadline_slot;
        grant.is_completed = false;
        grant.is_canceled = false;
        grant.bump = ctx.bumps.grant_account;
        grant.vault_bump = ctx.bumps.vault;

        // Deposit total grant funding from sponsor into Escrow Vault PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.sponsor.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        transfer(cpi_context, total_funding_amount)?;

        emit!(GrantCreatedEvent {
            grant: grant.key(),
            sponsor: grant.sponsor,
            recipient: grant.recipient,
            total_amount: total_funding_amount,
            total_milestones,
        });

        Ok(())
    }

    /// Builder submits proof/deliverable URI for the current milestone.
    pub fn submit_deliverable(
        ctx: Context<SubmitDeliverable>,
        deliverable_cid: String,
    ) -> Result<()> {
        require!(deliverable_cid.len() <= MAX_METADATA_LEN, UniVibeError::MetadataTooLong);

        let grant = &mut ctx.accounts.grant_account;
        require!(!grant.is_completed, UniVibeError::GrantAlreadyCompleted);
        require!(!grant.is_canceled, UniVibeError::GrantIsCanceled);
        require!(
            grant.current_milestone < grant.total_milestones,
            UniVibeError::AllMilestonesCompleted
        );

        let current_slot = Clock::get()?.slot;
        require!(current_slot <= grant.deadline_slot, UniVibeError::DeadlineExceeded);

        let milestone_state = &mut ctx.accounts.milestone_state;
        milestone_state.grant = grant.key();
        milestone_state.milestone_index = grant.current_milestone;
        milestone_state.deliverable_cid = deliverable_cid.clone();
        milestone_state.approvals_count = 0;
        milestone_state.is_disbursed = false;
        milestone_state.bump = ctx.bumps.milestone_state;

        emit!(DeliverableSubmittedEvent {
            grant: grant.key(),
            milestone_index: grant.current_milestone,
            deliverable_cid,
        });

        Ok(())
    }

    /// Committee members approve the current milestone.
    pub fn review_milestone(
        ctx: Context<ReviewMilestone>,
        approved: bool,
    ) -> Result<()> {
        let grant = &ctx.accounts.grant_account;
        require!(!grant.is_completed, UniVibeError::GrantAlreadyCompleted);
        require!(!grant.is_canceled, UniVibeError::GrantIsCanceled);

        let milestone_state = &mut ctx.accounts.milestone_state;
        require!(!milestone_state.is_disbursed, UniVibeError::MilestoneAlreadyDisbursed);

        let review_record = &mut ctx.accounts.review_record;
        review_record.grant = grant.key();
        review_record.reviewer = ctx.accounts.reviewer.key();
        review_record.milestone_index = grant.current_milestone;
        review_record.approved = approved;
        review_record.reviewed_at = Clock::get()?.unix_timestamp;

        if approved {
            milestone_state.approvals_count = milestone_state.approvals_count.checked_add(1).unwrap();
        }

        emit!(MilestoneReviewedEvent {
            grant: grant.key(),
            milestone_index: grant.current_milestone,
            reviewer: ctx.accounts.reviewer.key(),
            approved,
            current_approvals: milestone_state.approvals_count,
        });

        Ok(())
    }

    /// Disburse funds for an approved milestone to the recipient.
    pub fn disburse_milestone(ctx: Context<DisburseMilestone>) -> Result<()> {
        let grant = &mut ctx.accounts.grant_account;
        let milestone_state = &mut ctx.accounts.milestone_state;

        require!(!grant.is_completed, UniVibeError::GrantAlreadyCompleted);
        require!(!grant.is_canceled, UniVibeError::GrantIsCanceled);
        require!(!milestone_state.is_disbursed, UniVibeError::MilestoneAlreadyDisbursed);
        require!(
            milestone_state.approvals_count >= grant.approval_threshold,
            UniVibeError::InsufficientApprovals
        );

        let per_milestone_payout = grant
            .total_funding_amount
            .checked_div(grant.total_milestones as u64)
            .ok_or(UniVibeError::MathOverflow)?;

        milestone_state.is_disbursed = true;
        grant.amount_disbursed = grant.amount_disbursed.checked_add(per_milestone_payout).unwrap();
        grant.current_milestone = grant.current_milestone.checked_add(1).unwrap();

        if grant.current_milestone == grant.total_milestones {
            grant.is_completed = true;
        }

        // Vault seeds for PDA signing
        let grant_key = grant.key();
        let seeds = &[
            b"univibe_vault",
            grant_key.as_ref(),
            &[grant.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_instruction = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.recipient.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            transfer_instruction,
            signer_seeds,
        );

        transfer(cpi_ctx, per_milestone_payout)?;

        emit!(MilestoneDisbursedEvent {
            grant: grant.key(),
            milestone_index: grant.current_milestone - 1,
            amount: per_milestone_payout,
            recipient: grant.recipient,
            is_grant_completed: grant.is_completed,
        });

        Ok(())
    }

    /// Sponsor claws back remaining funds if deadline passed and deliverables not delivered.
    pub fn refund_expired_grant(ctx: Context<RefundExpiredGrant>) -> Result<()> {
        let grant = &mut ctx.accounts.grant_account;
        let current_slot = Clock::get()?.slot;

        require!(current_slot > grant.deadline_slot, UniVibeError::GrantNotExpired);
        require!(!grant.is_completed, UniVibeError::GrantAlreadyCompleted);
        require!(!grant.is_canceled, UniVibeError::GrantIsCanceled);

        let remaining_balance = ctx.accounts.vault.to_account_info().lamports();
        require!(remaining_balance > 0, UniVibeError::NoRemainingFunds);

        let grant_key = grant.key();
        let seeds = &[
            b"univibe_vault",
            grant_key.as_ref(),
            &[grant.vault_bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let transfer_instruction = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.sponsor.to_account_info(),
        };

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            transfer_instruction,
            signer_seeds,
        );

        transfer(cpi_ctx, remaining_balance)?;
        grant.is_canceled = true;

        emit!(GrantRefundedEvent {
            grant: grant.key(),
            refunded_amount: remaining_balance,
            sponsor: grant.sponsor,
        });

        Ok(())
    }
}

// -----------------------------------------------------------------------------
// ACCOUNT VALIDATION STRUCTS
// -----------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(title: String, metadata_cid: String)]
pub struct InitializeGrant<'info> {
    #[account(
        init,
        payer = sponsor,
        space = 8 + GrantAccount::LEN,
        seeds = [b"univibe_grant", sponsor.key().as_ref(), title.as_bytes()],
        bump
    )]
    pub grant_account: Account<'info, GrantAccount>,

    #[account(
        mut,
        seeds = [b"univibe_vault", grant_account.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub sponsor: Signer<'info>,

    /// CHECK: Recipient receiving the grant disbursements
    pub recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitDeliverable<'info> {
    #[account(
        mut,
        has_one = recipient @ UniVibeError::UnauthorizedRecipient
    )]
    pub grant_account: Account<'info, GrantAccount>,

    #[account(
        init,
        payer = recipient,
        space = 8 + MilestoneState::LEN,
        seeds = [
            b"milestone",
            grant_account.key().as_ref(),
            &[grant_account.current_milestone]
        ],
        bump
    )]
    pub milestone_state: Account<'info, MilestoneState>,

    #[account(mut)]
    pub recipient: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReviewMilestone<'info> {
    pub grant_account: Account<'info, GrantAccount>,

    #[account(
        mut,
        seeds = [
            b"milestone",
            grant_account.key().as_ref(),
            &[grant_account.current_milestone]
        ],
        bump = milestone_state.bump
    )]
    pub milestone_state: Account<'info, MilestoneState>,

    #[account(
        init,
        payer = reviewer,
        space = 8 + ReviewRecord::LEN,
        seeds = [
            b"review",
            grant_account.key().as_ref(),
            &[grant_account.current_milestone],
            reviewer.key().as_ref()
        ],
        bump
    )]
    pub review_record: Account<'info, ReviewRecord>,

    #[account(mut)]
    pub reviewer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DisburseMilestone<'info> {
    #[account(
        mut,
        has_one = recipient @ UniVibeError::UnauthorizedRecipient,
        has_one = vault @ UniVibeError::InvalidVault
    )]
    pub grant_account: Account<'info, GrantAccount>,

    #[account(
        mut,
        seeds = [
            b"milestone",
            grant_account.key().as_ref(),
            &[grant_account.current_milestone]
        ],
        bump = milestone_state.bump
    )]
    pub milestone_state: Account<'info, MilestoneState>,

    #[account(mut)]
    pub vault: SystemAccount<'info>,

    /// CHECK: Validated via has_one on grant_account
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundExpiredGrant<'info> {
    #[account(
        mut,
        has_one = sponsor @ UniVibeError::UnauthorizedSponsor,
        has_one = vault @ UniVibeError::InvalidVault
    )]
    pub grant_account: Account<'info, GrantAccount>,

    #[account(mut)]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub sponsor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// -----------------------------------------------------------------------------
// DATA STATES
// -----------------------------------------------------------------------------

#[account]
pub struct GrantAccount {
    pub sponsor: Pubkey,
    pub recipient: Pubkey,
    pub vault: Pubkey,
    pub title: String,
    pub metadata_cid: String,
    pub total_funding_amount: u64,
    pub amount_disbursed: u64,
    pub total_milestones: u8,
    pub current_milestone: u8,
    pub approval_threshold: u8,
    pub deadline_slot: u64,
    pub is_completed: bool,
    pub is_canceled: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

impl GrantAccount {
    pub const LEN: usize = 32 + 32 + 32 + (4 + MAX_TITLE_LEN) + (4 + MAX_METADATA_LEN) + 8 + 8 + 1 + 1 + 1 + 8 + 1 + 1 + 1 + 1;
}

#[account]
pub struct MilestoneState {
    pub grant: Pubkey,
    pub milestone_index: u8,
    pub deliverable_cid: String,
    pub approvals_count: u8,
    pub is_disbursed: bool,
    pub bump: u8,
}

impl MilestoneState {
    pub const LEN: usize = 32 + 1 + (4 + MAX_METADATA_LEN) + 1 + 1 + 1;
}

#[account]
pub struct ReviewRecord {
    pub grant: Pubkey,
    pub reviewer: Pubkey,
    pub milestone_index: u8,
    pub approved: bool,
    pub reviewed_at: i64,
}

impl ReviewRecord {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8;
}

// -----------------------------------------------------------------------------
// EVENTS & ERRORS
// -----------------------------------------------------------------------------

#[event]
pub struct GrantCreatedEvent {
    pub grant: Pubkey,
    pub sponsor: Pubkey,
    pub recipient: Pubkey,
    pub total_amount: u64,
    pub total_milestones: u8,
}

#[event]
pub struct DeliverableSubmittedEvent {
    pub grant: Pubkey,
    pub milestone_index: u8,
    pub deliverable_cid: String,
}

#[event]
pub struct MilestoneReviewedEvent {
    pub grant: Pubkey,
    pub milestone_index: u8,
    pub reviewer: Pubkey,
    pub approved: bool,
    pub current_approvals: u8,
}

#[event]
pub struct MilestoneDisbursedEvent {
    pub grant: Pubkey,
    pub milestone_index: u8,
    pub amount: u64,
    pub recipient: Pubkey,
    pub is_grant_completed: bool,
}

#[event]
pub struct GrantRefundedEvent {
    pub grant: Pubkey,
    pub refunded_amount: u64,
    pub sponsor: Pubkey,
}

#[error_code]
pub mod UniVibeError {
    #[msg("Title string exceeds maximum length.")]
    TitleTooLong,
    #[msg("Metadata CID string exceeds maximum length.")]
    MetadataTooLong,
    #[msg("Milestone count must be greater than zero.")]
    InvalidMilestoneCount,
    #[msg("Approval threshold must be greater than zero.")]
    InvalidApprovalThreshold,
    #[msg("Funding amount must be greater than zero.")]
    ZeroFundingAmount,
    #[msg("Deadline must be greater than current slot.")]
    InvalidDeadline,
    #[msg("Grant is already completed.")]
    GrantAlreadyCompleted,
    #[msg("Grant was canceled.")]
    GrantIsCanceled,
    #[msg("All milestones have already been completed.")]
    AllMilestonesCompleted,
    #[msg("Deadline for this grant milestone has passed.")]
    DeadlineExceeded,
    #[msg("Signer is not authorized recipient.")]
    UnauthorizedRecipient,
    #[msg("Signer is not authorized sponsor.")]
    UnauthorizedSponsor,
    #[msg("Vault address does not match grant configuration.")]
    InvalidVault,
    #[msg("Milestone payout already disbursed.")]
    MilestoneAlreadyDisbursed,
    #[msg("Insufficient approvals to disburse milestone.")]
    InsufficientApprovals,
    #[msg("Grant has not yet reached expiration deadline.")]
    GrantNotExpired,
    #[msg("No remaining funds available in vault.")]
    NoRemainingFunds,
    #[msg("Arithmetic overflow detected.")]
    MathOverflow,
}