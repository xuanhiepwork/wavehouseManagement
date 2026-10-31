import { Schema, model } from 'mongoose';

export interface IIngredient {
    code: string;
    name: string;
    category: string;
    unit: 'g' | 'ml' | 'piece';
    costPrice: number;
    minStock: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ingredientSchema = new Schema<IIngredient>({
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    unit: { type: String, required: true, enum: ['g', 'ml', 'piece'] },
    costPrice: {
        type: Number, required: true, min: 0,
        validate: { validator: Number.isFinite, message: 'costPrice must be finite' },
    },
    minStock: {
        type: Number, required: true, min: 0, default: 0,
        validate: { validator: Number.isFinite, message: 'minStock must be finite' },
    },
    isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true });

// Stock quantities belong to branch-specific inventory, not the ingredient catalog.
ingredientSchema.index({ code: 1 }, { unique: true });

export const Ingredient = model<IIngredient>('Ingredient', ingredientSchema);
export default Ingredient;
