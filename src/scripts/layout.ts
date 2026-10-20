// The two page layouts, decided in one place for the scripts. CSS uses the same
// query literally (Step.astro, cards/ClusterCard.astro); keep them in step.
//
// stacked: phones held upright. The map takes the top of the screen and the
//          active card sits below it.
// side:    everything else, including phones turned sideways (too short to stack).
export const STACKED_QUERY = '(max-width: 959px) and (min-height: 501px)';

export const stackedLayout = () => matchMedia(STACKED_QUERY);
