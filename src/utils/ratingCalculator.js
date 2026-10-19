const emptyDistribution = () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

const calculateRatingSummary = (ratings) => {
  const distribution = emptyDistribution();
  ratings.forEach((rating) => {
    distribution[rating] += 1;
  });
  const totalReviews = ratings.length;
  const averageRating =
    totalReviews === 0
      ? 0
      : Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / totalReviews) * 10) / 10;

  return { averageRating, totalReviews, distribution };
};

module.exports = { calculateRatingSummary, emptyDistribution };
