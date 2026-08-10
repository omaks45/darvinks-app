-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "customerType" "CustomerType" NOT NULL DEFAULT 'PRIMARY',
ADD COLUMN     "secondaryCustomerType" "SecondaryCustomerType";
