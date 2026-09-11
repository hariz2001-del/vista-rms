import type { Brand, Category, Product } from '../../domain/types.ts'

/** Same ids as the POS and the API seed, so the three line up. */

export const BRAND_FOOD = 'a1000000-0000-4000-8000-000000000001'
export const BRAND_DRINKS = 'a1000000-0000-4000-8000-000000000002'

export const BRANDS: Brand[] = [
  {
    id: BRAND_FOOD,
    name: 'Food',
    colour: '#ef6c35',
    softColour: '#fff0e8',
    chartColour: '#e2601f',
  },
  {
    id: BRAND_DRINKS,
    name: 'Drinks',
    colour: '#087f8c',
    softColour: '#e4f6f7',
    chartColour: '#0a8fa0',
  },
]

const CAT = {
  rice: 'b1000000-0000-4000-8000-000000000001',
  burgers: 'b1000000-0000-4000-8000-000000000002',
  noodles: 'b1000000-0000-4000-8000-000000000003',
  sides: 'b1000000-0000-4000-8000-000000000004',
  coffee: 'b1000000-0000-4000-8000-000000000005',
  tea: 'b1000000-0000-4000-8000-000000000006',
  cold: 'b1000000-0000-4000-8000-000000000007',
}

export const CATEGORIES: Category[] = [
  { id: CAT.rice, brandId: BRAND_FOOD, name: 'Rice' },
  { id: CAT.burgers, brandId: BRAND_FOOD, name: 'Burgers' },
  { id: CAT.noodles, brandId: BRAND_FOOD, name: 'Noodles' },
  { id: CAT.sides, brandId: BRAND_FOOD, name: 'Sides' },
  { id: CAT.coffee, brandId: BRAND_DRINKS, name: 'Coffee' },
  { id: CAT.tea, brandId: BRAND_DRINKS, name: 'Tea' },
  { id: CAT.cold, brandId: BRAND_DRINKS, name: 'Cold Drinks' },
]

export const PRODUCTS: Product[] = [
  { id: '20000000-0000-4000-8000-000000000001', brandId: BRAND_FOOD, categoryId: CAT.rice, name: 'Nasi Lemak Ayam', basePriceSen: 1200, imageUrl: '/products/nasi-lemak.svg', isSoldOut: false, isActive: true },
  { id: '20000000-0000-4000-8000-000000000002', brandId: BRAND_FOOD, categoryId: CAT.rice, name: 'Nasi Goreng Kampung', basePriceSen: 1000, imageUrl: '/products/nasi-goreng.svg', isSoldOut: false, isActive: true },
  { id: '20000000-0000-4000-8000-000000000003', brandId: BRAND_FOOD, categoryId: CAT.burgers, name: 'Burger Ayam Special', basePriceSen: 1050, imageUrl: '/products/burger.svg', isSoldOut: false, isActive: true },
  { id: '20000000-0000-4000-8000-000000000004', brandId: BRAND_FOOD, categoryId: CAT.burgers, name: 'Roti John Daging', basePriceSen: 950, imageUrl: '/products/roti-john.svg', isSoldOut: false, isActive: true },
  { id: '20000000-0000-4000-8000-000000000005', brandId: BRAND_FOOD, categoryId: CAT.noodles, name: 'Mee Goreng Mamak', basePriceSen: 900, imageUrl: '/products/mee-goreng.svg', isSoldOut: false, isActive: true },
  { id: '20000000-0000-4000-8000-000000000006', brandId: BRAND_FOOD, categoryId: CAT.sides, name: 'Ayam Goreng Berempah', basePriceSen: 800, imageUrl: '/products/ayam-goreng.svg', isSoldOut: false, isActive: true },
  { id: '20000000-0000-4000-8000-000000000007', brandId: BRAND_FOOD, categoryId: CAT.sides, name: 'Kentang Goreng', basePriceSen: 600, imageUrl: '/products/fries.svg', isSoldOut: true, isActive: true },
  { id: '30000000-0000-4000-8000-000000000001', brandId: BRAND_DRINKS, categoryId: CAT.coffee, name: 'Kopi Ais', basePriceSen: 550, imageUrl: '/products/coffee.svg', isSoldOut: false, isActive: true },
  { id: '30000000-0000-4000-8000-000000000002', brandId: BRAND_DRINKS, categoryId: CAT.coffee, name: 'Milo Ais Kaw', basePriceSen: 600, imageUrl: '/products/milo.svg', isSoldOut: false, isActive: true },
  { id: '30000000-0000-4000-8000-000000000003', brandId: BRAND_DRINKS, categoryId: CAT.tea, name: 'Teh Limau Ais', basePriceSen: 450, imageUrl: '/products/tea.svg', isSoldOut: false, isActive: true },
  { id: '30000000-0000-4000-8000-000000000004', brandId: BRAND_DRINKS, categoryId: CAT.tea, name: 'Teh O Ais Limau', basePriceSen: 400, imageUrl: '/products/teh-o.svg', isSoldOut: false, isActive: true },
  { id: '30000000-0000-4000-8000-000000000005', brandId: BRAND_DRINKS, categoryId: CAT.cold, name: 'Soda Laici', basePriceSen: 700, imageUrl: '/products/soda.svg', isSoldOut: false, isActive: true },
  { id: '30000000-0000-4000-8000-000000000006', brandId: BRAND_DRINKS, categoryId: CAT.cold, name: 'Sirap Bandung', basePriceSen: 500, imageUrl: '/products/bandung.svg', isSoldOut: false, isActive: true },
  { id: '30000000-0000-4000-8000-000000000007', brandId: BRAND_DRINKS, categoryId: CAT.cold, name: 'Air Kelapa Muda', basePriceSen: 800, imageUrl: '/products/kelapa.svg', isSoldOut: true, isActive: true },
]

export const PRODUCT_BY_ID = new Map(PRODUCTS.map((product) => [product.id, product]))
export const BRAND_BY_ID = new Map(BRANDS.map((brand) => [brand.id, brand]))
export const CATEGORY_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]))
