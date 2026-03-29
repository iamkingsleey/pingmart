-- AlterEnum
ALTER TYPE "ConversationState" ADD VALUE 'AWAITING_ITEM_NOTE';

-- AlterTable
ALTER TABLE "conversation_sessions" ADD COLUMN     "lastMessageId" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "notes" TEXT;
